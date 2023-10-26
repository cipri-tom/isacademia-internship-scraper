import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

// I hate GLOBAL variables as much as the next person
// But in this case, it's a small script and very few risks
// On the flip case, it allows to not mix data and Browser elements in function parameters

// used to interact with the browser page
let page;

const INTERNSHIP_HOMEPAGE = 'https://isa.epfl.ch/imoniteur_ISAP/PORTAL23S.htm';
const SELECTORS = {
    login: '#ww_x_username',
}

const EXPECTED_HEADERS = ['name', 'email', 'phone', 'internship', 'department', 'date'];

const destDir = process.argv[2];
if (!destDir) {
    console.error('Usage: node scrape-interns.js /path/to/destination/folder');
    process.exit(1);
}
if (! fs.existsSync(destDir) || ! fs.lstatSync(destDir).isDirectory()) {
    console.error('Path "%s" does not exist or is not a directory', destDir);
    process.exit(1);
}

async function writeExcel(data) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Interns');

    const headers = Object.keys(data[0]);
    // Check if all expected headers are present
    const missingHeaders = EXPECTED_HEADERS.filter(header => headers.indexOf(header) < 0);
    if (missingHeaders.length) {
        console.error('Error in headers. Missing: ', missingHeaders);
    }

    worksheet.addRow(EXPECTED_HEADERS);

    // Iterate through the data and add it to the worksheet
    data.forEach(item => {
        const values = EXPECTED_HEADERS.map(header => item[header]);
        worksheet.addRow(values);
    });

    // Save the workbook to a file
    const destFile = path.join(destDir, 'interns.xlsx');
    await workbook.xlsx.writeFile(destFile);

    console.log('Excel file created successfully at %s', destFile);
}

// NOTE: often times, data is loaded by async XHR request, which cannot be awaited for
//      I have tried the package `pending-xhr-puppeteer`, but it's not reliable :(
//      so you will see a few anti-patterns of random waiting here and there
// This returns a promise that can be combined with others to wait at least this long
async function XHR(ms) {
    console.log('Waiting for XHR...')
    return new Promise(r => setTimeout(r, ms || 2000));
}

async function XHRLoading(promise) {
    return Promise.all([
        promise,
        page.waitForNavigation(),
        page.waitForNetworkIdle(),
    ])
}

async function getFirstVisible(node, selector, successMsg) {
    // not working: page.waitForSelector(selector, {visible: true})
    // see https://github.com/puppeteer/puppeteer/issues/6389
    const matches = await node.$$(selector);
    for (let match of matches)
        if (await match.isVisible()) {
            if (successMsg)
                console.log(successMsg);
            return match;
        }
    throw new Error(`Could not find element for selector "${selector}"`);
}

async function processStudent(studData) {
    // there are many iframes, but the shown one is in a div that ends with `_900`
    const studentDataIFrameSelector = '[id$=_900] > iframe';
    const studFrameElement = await page.$(studentDataIFrameSelector);
    if (!studFrameElement) {
        console.error('Could not find student frame', studFrameElement);
        process.exit(1);
    }

    const studFrame = await studFrameElement.contentFrame();
    await page.waitForNetworkIdle();

    console.log('On page of student: %s', studData.name);

    const studDir = path.join(destDir, studData.name);
    if (!fs.existsSync(studDir)) {
        fs.mkdirSync(studDir);
    }

    studData.email = await studFrame.$eval('td.inscrstage-entr-infos-email', el => el.innerText);
    studData.phone = await studFrame.$eval('td.inscrstage-entr-infos-tel'  , el => el.innerText);

    const filesElements = await studFrame.$$('table.prtl-se-affichage a');
    console.log('Found %d files', filesElements.length);

    for (let file of filesElements) {
        const fileName = await file.evaluate(node => node.innerText);
        const filePath = path.join(studDir, fileName);
        if (fs.existsSync(filePath)) {
            console.log('File %s exists', fileName);
            continue;
        }

        // make browser download files to a directory
        // see: https://github.com/puppeteer/puppeteer/issues/299#issuecomment-1767664921
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: studDir,
        });

        await file.evaluate((a, fn) => {
            a.removeAttribute('target');
            a.setAttribute('download', fn);
            console.log('setting download to', fn);
        }, fileName);
        console.log(fileName);

        await file.click();
    }

    const returnButtonPromise = studFrame.$('div.inscrstage-entr-retour a');
    return returnButtonPromise;
}

async function setupPage() {
    const browserURL = 'http://127.0.0.1:21222';
    const browser = await puppeteer.connect({browserURL});
    // const browser = await puppeteer.launch({headless: false});
    // const page = await browser.newPage();

    const pages = await browser.pages();
    if (pages.length < 2) {
        console.error("You don't have a 2nd tab open, and we don't want to overwrite your 1st tab.")
        process.exit(1);
    }

    // Setup global page variable
    page = pages[1];
    await page.setViewport({width: 1365, height: 1330}); // recommended to set some size
    await page.setDefaultTimeout(5000);
}

async function ensureLogin() {
    try {
        // throw an error if we're not logged in
        const found = await page.waitForSelector(SELECTORS.login, {timeout: 1000});
        console.error("FAILED: You're not logged in. Log in first, in the same browser!");
        page.setContent(
            "FAILED: You're not logged in. Log in first, in the same browser!.<br/> " +
            "We will take you to the log in page in a few seconds...<br/>" +
            "After you log in, run the script again.");
            // "sleep" a bit, so we see the message
            await page.waitForSelector("#__inexistent__", {timeout: 10000});
        } catch (error) {
            // expected, didn't find, we can close the page
            page.goto(INTERNSHIP_HOMEPAGE);
        }
        process.exit(1);
    } catch (error) {
        console.log("It seems you're logged in ! 👍");
    }
}



(async () => {
    // start Google Chrome from "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=21222

    // then go to https://isa.epfl.ch/imoniteur_ISAP/isacademia.htm
    // and log in
    // This way you don't need to type your password in the terminal
    // and you can use the password manager
    // The session remembers you've logged in, so the script assumes this

    // Keep the first tab open to not lose your session
    // this script works with the 2nd tab, because it allows us to have an inspector open there

    // only then you can launch this

    await setupPage();

    await XHRLoading(
        page.goto(INTERNSHIP_HOMEPAGE),
    );
    await ensureLogin();

    // get the internship table and click on the number of registered students, to see them all
    const internshipTablesSelector = 'table[name*=listeStage]';
    const internshipTable = await getFirstVisible(page, internshipTablesSelector,
        "Found internship table");
    console.log('Going to registered students...')

    const registeredStudentsSelector = 'td:nth-of-type(5) > a'
    const registeredStudents = await internshipTable.$(registeredStudentsSelector);
    await XHRLoading(
        registeredStudents.click(),
    );

    let internshipName = await getFirstVisible(page, 'table.prtl-se-TableEntete td.prtl-se-TableTitle');
    internshipName = await internshipName.evaluate(el => el.innerText);

    // Unfortunately, the portal loads student pages dynamically via XHR requests
    // This means that when we access a student, we lose current context.
    // As such, we cannot iterate through the nice `students` table, as the elements are detached when we get back
    // => we iterate through integers, and re-select the table each time we come back to the page
    const registeredStudentsTablesSelector = 'table.prtl-se-Table.prtl-se-affichageListPostulants';
    const studentsSelector = 'tbody tr';
    let students = [];
    let allStudData = [];
    let currStudentIdx = 0;
    do {
        console.log("-----------------------------------------------------------")
        // const studentsTable = await page.waitForSelector(registeredStudentsTablesSelector, {visible: true});
        const studentsTable = await getFirstVisible(page, registeredStudentsTablesSelector);

        // first column has student name
        students = await studentsTable.$$(studentsSelector);
        const student = students[currStudentIdx];

        // some student data is ONLY available here, before going to student page
        let studData = {
            name:       await student.$eval('td:nth-of-type(1)', el => el.innerText),
            department: await student.$eval('td:nth-of-type(2)', el => el.innerText),
            date:       await student.$eval(`td:nth-of-type(4)`, el => el.innerText),
            internship: internshipName,
        }

        // enter student
        await XHRLoading(
            (await student.$('td:first-of-type')).click()
        );
        const backToStudentsButton = await processStudent(studData);

        // exit student
        await XHRLoading(
            backToStudentsButton.click(),
        );
        console.log(studData);
        allStudData.push(studData);

        currStudentIdx++;
    } while (currStudentIdx < students.length);

    console.log("-----------------------------------------------------------")
    await writeExcel(allStudData);

    console.log('DONE 🎉');

    // without this, the script doesn't finish
    await browser.disconnect();
})()
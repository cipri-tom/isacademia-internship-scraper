import puppeteer, { TimeoutError } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

// NOTE 1:
// Unfortunately, the portal loads pages dynamically via XHR requests
// This means that when we access an internship, or a student, we lose the context.
// As such, any elements created thus far will be detached, and we need to select them again
// Therefore, we adopt the `do... while()` pattern instead of `for ... of`.
// => we iterate through integers, and re-select the table each time we come back to the page

// NOTE 2:
// the caller function takes care of navigating to the page and back, not the calee
// because the callee cannot really know where to go back
// This is facilitated by the fact that we have a stable menu on the right side of the page
// or the "Back to internship" button on Student page

// NOTE 3:
// We cannot use `waitForSelector()` function, as it often selects a non-visible one
// Yes, the page loads all data at start, and then kind of switches between their visibility
// The IDs are generated, so we cannot reliably use them.
// For example, there are 3-4 students tables appearing in the page, but only one is visible
// The others represent students from previous internships
// So instead, we have our own function, `getFirstVisible(node, selector)`

// I hate GLOBAL variables as much as the next person
// But in this case, it's a small script and very few risks
// On the flip case, it simplifies state a lot by not passing these back and forth

// used to interact with the browser page
let browser, page;

const INTERNSHIP_HOMEPAGE = 'https://isa.epfl.ch/imoniteur_ISAP/PORTAL23S.htm';
const SELECTORS = {
    login: '#ww_x_username',

    // "all internships" page
    internshipsTable: 'table[name*=listeStage]',
    internships: 'tbody > tr', // as part of previous Table
    internshipTitle: 'td:nth-of-type(3)',
    registeredStudentsNumber: 'td:nth-of-type(5) > a',

    // candidates page
    internshipName: 'table.prtl-se-TableEntete td.prtl-se-TableTitle',
    registeredStudentsTables: 'table.prtl-se-Table.prtl-se-affichageListPostulants',
    studentsRows: 'tbody tr',

    // student personal page
    // there are many iframes, but the shown one is in a div that ends with `_900`
    studentDataIFrame: '[id$=_900] > iframe',
    studentDataEmail: 'td.inscrstage-entr-infos-email',
    studentDataPhone: 'td.inscrstage-entr-infos-tel',
    studentFiles: 'table.prtl-se-affichage a',
    studentReturnButton: 'div.inscrstage-entr-retour a',
}

const EXPECTED_HEADERS = ['name', 'email', 'phone', 'internship', 'department', 'date'];

const destDir = process.argv[2];
if (!destDir) {
    console.error('Usage: node scrape-interns.js /path/to/destination/folder');
    process.exit(1);
}
if (! fs.existsSync(destDir) || ! fs.lstatSync(destDir).isDirectory()) {
    throw new Error(`Path ${destDir} does not exist or is not a directory)`);
}

function sanitizeSheetName(internshipName) {
    const forbiddenChars = /[\*\?\\:\/\[\]]/g;
    return internshipName.replace(forbiddenChars, '-').substring(0, 31);
}

async function getExistingStudentNames(internshipName) {
    const destFile = path.join(destDir, 'interns.xlsx');
    if (!fs.existsSync(destFile)) {
        return new Set();
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(destFile);

    const worksheet = workbook.getWorksheet(sanitizeSheetName(internshipName));
    if (!worksheet) {
        return new Set();
    }

    const existingNames = new Set();
    const nameIdx = EXPECTED_HEADERS.indexOf('name') + 1; // ExcelJS uses 1-based indexing

    const rows = worksheet.getRows(2, worksheet.rowCount); // Skip header row
    if (rows) {
        rows.forEach(row => {
            if (row && row.values && row.values.length > nameIdx) {
                existingNames.add(row.values[nameIdx]);
            }
        });
    }

    console.log('Found %d existing records in Excel', existingNames.size);
    return existingNames;
}

async function writeExcel(data, internshipName) {
    const destFile = path.join(destDir, 'interns.xlsx');
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(destFile)) {
        await workbook.xlsx.readFile(destFile);
    }

    const sanitizedSheetName = sanitizeSheetName(internshipName);

    // Check if the worksheet already exists
    let worksheet = workbook.getWorksheet(sanitizedSheetName);

    if (!worksheet) {
        // Add a new worksheet
        worksheet = workbook.addWorksheet(sanitizedSheetName);

        const headers = Object.keys(data[0]);
        // Check if all expected headers are present
        const missingHeaders = EXPECTED_HEADERS.filter(header => headers.indexOf(header) < 0);
        if (missingHeaders.length) {
            console.error('Error in headers. Missing: ', missingHeaders);
        }

        worksheet.addRow(EXPECTED_HEADERS);
    }

    // Iterate through the data and add it to the worksheet
    data.forEach(item => {
        const values = EXPECTED_HEADERS.map(header => item[header]);
        worksheet.addRow(values);
    });

    await workbook.xlsx.writeFile(destFile);

    console.log('Excel file updated successfully at %s', destFile);
}

// NOTE: often times, data is loaded by async XHR request, which cannot be awaited for
//      I have tried the package `pending-xhr-puppeteer`, but it's not reliable :(
//      so you will see a few anti-patterns of random waiting here and there
// This returns a promise that can be combined with others to wait at least this long
async function sleep(ms) {
    console.log('Sleeping for XHR...')
    return new Promise(r => setTimeout(r, ms || 2000));
}

async function XHRLoading(promise) {
    const [result] = await Promise.all([
        promise,
        page.waitForNavigation(),
        page.waitForNetworkIdle(),
    ]);
    return result;
}

async function getFirstVisible(selector, successMsg) {
    // not working: page.waitForSelector(selector, {visible: true})
    // see https://github.com/puppeteer/puppeteer/issues/6389
    const matches = await page.$$(selector);
    for (let match of matches)
        if (await match.isVisible()) {
            if (successMsg)
                console.log(successMsg);
            return match;
        }
    throw new Error(`Could not find element for selector "${selector}"`);
}

async function processStudent(studData) {
    await page.waitForNetworkIdle();
    const studFrameElement = await page.$(SELECTORS.studentDataIFrame);
    if (!studFrameElement) {
        throw new Error(`Could not find student frame ${studFrameElement}`);
    }

    const studFrame = await studFrameElement.contentFrame();
    await page.waitForNetworkIdle();

    console.log('On page of student: %s', studData.name);

    const studDir = path.join(destDir, studData.name);
    if (!fs.existsSync(studDir)) {
        fs.mkdirSync(studDir);
    }

    studData.email = await studFrame.$eval(SELECTORS.studentDataEmail, el => el.innerText);
    studData.phone = await studFrame.$eval(SELECTORS.studentDataPhone, el => el.innerText);

    const filesElements = await studFrame.$$(SELECTORS.studentFiles);
    console.log('Found %d files', filesElements.length);

    for (const file of filesElements) {
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

        // set file to download on click, and set its name
        await file.evaluate((a, fn) => {
            a.removeAttribute('target');
            a.setAttribute('download', fn);
            console.log('setting download to', fn);
        }, fileName);
        console.log(fileName);

        // trigger the download
        await file.click();
    }

    const returnButtonPromise = studFrame.$(SELECTORS.studentReturnButton);
    return returnButtonPromise;
}

async function setupPage() {
    const browserURL = 'http://127.0.0.1:21222';
    try {
        browser = await puppeteer.connect({browserURL});
        // const browser = await puppeteer.launch({headless: false});
        // const page = await browser.newPage();
    } catch (error) {
        console.error('🛑 Cannot connect to Chrome.\n\n⚠️ Please start Google Chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=21222')
        process.exit(1);
    }

    // Setup global page variable
    const pages = await browser.pages();
    if (pages.length == 1) {
        console.error('🛑 Cannot find 2nd open tab.\n\n⚠️ Opening 2nd tab');
        page = await browser.newPage();
    }
    else {
        page = pages[1];
    }

    await page.setViewport({width: 1365, height: 1330}); // recommended to set some size
    await page.setDefaultTimeout(10000);
}

async function ensureLogin() {
    console.log('Checking if logged in...');
    try {
        // throw an error if we're not logged in
        const found = await page.waitForSelector(SELECTORS.login, {timeout: 1000});
        page.setContent(
            "FAILED: You're not logged in. Log in first, in the same browser!.<br/> " +
            "We will take you to the log in page in a few seconds...<br/>" +
            "After you log in, run the script again.");
        await sleep(10000);
        await page.goto(INTERNSHIP_HOMEPAGE);
        console.error("🛑 You're not logged in.");
        console.error("⚠️ Please use the 1st tab to log in, and open a 2nd empty tab.");
    } catch (error) {
        if (error instanceof TimeoutError)
            console.log("It seems you're logged in ! 👍");
        else
            throw error;
    }
}

async function* getInternships() {
    // See NOTE 1. due to single page app, we risk losing context, so we have to
    // reselect the table at each iteration
    let currentInternshipIdx = 0;
    let internships;
    do {
        const internshipsTable = await getFirstVisible(SELECTORS.internshipsTable,
            currentInternshipIdx === 0 ? 'Found internship table' : undefined);
        internships = await internshipsTable.$$(SELECTORS.internships);
        if (currentInternshipIdx === 0) {
            console.log(`There are ${internships.length} internships.`);
        }
        yield internships[currentInternshipIdx];
        currentInternshipIdx++;
    } while(currentInternshipIdx < internships.length);
}

async function* getStudents(internship) {
    let students = [];
    let currStudentIdx = 0;

    do {
        const studentsTable = await getFirstVisible(SELECTORS.registeredStudentsTables);

        students = await studentsTable.$$(SELECTORS.studentsRows);
        if (currStudentIdx === 0)
            console.log(`There are ${students.length} students.`);

        yield students[currStudentIdx];
        currStudentIdx++;
    } while (currStudentIdx < students.length);
}

async function processInternship(internship) {
    let internshipName = await getFirstVisible(SELECTORS.internshipName);
    internshipName = await internshipName.evaluate(el => el.innerText);

    // Get existing student names to avoid re-scraping them
    const existingNames = await getExistingStudentNames(internshipName);

    let allStudData = [];
    for await (const student of getStudents()) {
        console.log("-----------------------------------------------------------")

        // some student data is ONLY available here, before going to student page
        const studentName = await student.$eval('td:nth-of-type(1)', el => el.innerText);

        // Skip if student already exists in Excel
        if (existingNames.has(studentName)) {
            console.log('Skipping existing student: %s', studentName);
            continue;
        }

        let studData = {
            name:       studentName,
            department: await student.$eval('td:nth-of-type(2)', el => el.innerText),
            date:       await student.$eval(`td:nth-of-type(4)`, el => el.innerText),
            internship: internshipName,
        }

        // enter student
        await XHRLoading(
            (await student.$('td:first-of-type')).click()
        );
        // we cannot find the button ourselves because it's in a frame found by the function
        const backToStudentsButton = await processStudent(studData);

        // exit student
        await XHRLoading(
            backToStudentsButton.click(),
        );
        console.log(studData);
        allStudData.push(studData);
    }

    console.log("-----------------------------------------------------------")
    if (allStudData.length > 0) {
        await writeExcel(allStudData, internshipName);
    } else {
        console.log('No new students to add');
    }
}

async function main() {
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

    for await (const internship of getInternships()) {
        const internshipTitle = await internship.$eval(SELECTORS.internshipTitle, el => el.innerText);
        console.log(`Going to students for ${internshipTitle}`);

        // go to internship
        const registeredStudents = await internship.$(SELECTORS.registeredStudentsNumber);
        const numStudents = await registeredStudents.evaluate(el => el.innerText);
        console.log(`There are ${numStudents} registered students`);
        await XHRLoading(
            registeredStudents.click()
        );

        await processInternship(internship);

        // return from internship. We take a shortcut, and go to the main page
        await XHRLoading(
            page.goto(INTERNSHIP_HOMEPAGE)
        );
    }

    console.log('DONE 🎉');
}

try {
    await main();
} finally {
    // without this, the script doesn't finish
    if (browser)
        await browser.disconnect();
}

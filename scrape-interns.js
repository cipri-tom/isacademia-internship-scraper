import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

let page; // GLOBAL variable used to interact with the browser page

const destDir = process.argv[2];
if (!destDir) {
    console.error('Usage: node scrape-interns.js /path/to/destination/folder');
    process.exit(1);
}
if (! fs.existsSync(destDir) || ! fs.lstatSync(destDir).isDirectory()) {
    console.error('Path "%s" does not exist or is not a directory', destDir);
    process.exit(1);
}

// NOTE: often times, data is loaded by async XHR request, which cannot be awaited for
//      I have tried the package `pending-xhr-puppeteer`, but it's not reliable :(
//      so you will see a few anti-patterns of random waiting here and there
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
        if (await match.boundingBox()) {
            if (successMsg)
                console.log(successMsg);
            return match;
        }
    throw new Error(`Could not find element for selector "${selector}"`);
}

async function processStudent() {
    // there are many iframes, but the shown one is in a div that ends with `_900`
    const studentDataIFrameSelector = '[id$=_900] > iframe';
    const studFrameElement = await page.$(studentDataIFrameSelector);
    if (!studFrameElement) {
        console.error('Could not find student frame', studFrameElement);
        process.exit(1);
    }

    const studFrame = await studFrameElement.contentFrame();
    await page.waitForNetworkIdle();

    const studNameElement = await studFrame.$('td.inscrstage-entr-infos-etu');
    const studName = await studNameElement.evaluate(node => node.innerText);
    console.log('On page of student: %s', studName);

    const studDir = path.join(destDir, studName);
    if (!fs.existsSync(studDir)) {
        fs.mkdirSync(studDir);
    }

    const studEmail = await studFrame.$eval('td.inscrstage-entr-infos-email'     , el => el.innerText);
    const studPhone = await studFrame.$eval('td.inscrstage-entr-infos-tel'       , el => el.innerText);
    const studInternship = await studFrame.$eval('td.inscrstage-entr-infos-stage', el => el.innerText);

    console.log(studEmail, studPhone, studInternship);

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

(async () => {
    // start Google Chrome from "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=21222

    // then go to https://isa.epfl.ch/imoniteur_ISAP/isacademia.htm
    // and log in
    // This way you don't need to type your password in the terminal
    // and you can use the password manager
    // The session remembers you've logged in, so the next script assumes this


    // only then you can launch this
    const browserURL = 'http://127.0.0.1:21222';
    const browser = await puppeteer.connect({browserURL});
    // const browser = await puppeteer.launch({headless: false});
    // const page = await browser.newPage();

    // Keep the first tab open to not lose your session
    // this script works with the 2nd tab, because it allows us to have an inspector open there
    const pages = await browser.pages();
    if (pages.length < 2) {
        console.error("You don't have a 2nd tab open, and we don't want to overwrite your 1st tab.")
        process.exit(1);
    }

    // Setup global page variable
    page = pages[1];
    await page.setViewport({width: 1365, height: 1330}); // recommended to set some size
    await page.setDefaultTimeout(5000);

    // When you're on mac and using proxy, this page takes AGES to load
    // most probably due to the proxy. The network request is pending, rather than stuck at the server
    // So, I run this through a tunnel to bypass the proxy
    // Update Oct 2023: it seems to work through the proxy now, no worries
    await XHRLoading(
        page.goto('https://isa.epfl.ch/imoniteur_ISAP/isacademia.htm'),
    );
    try {
        // throw an error if we're not logged in
        const loginSelector = '#ww_x_username';
        const found = await page.waitForSelector(loginSelector, {timeout: 1000});
        console.error("FAILED: You're not logged in. Log in first, in the same browser!");
        page.setContent(
            "FAILED: You're not logged in. Log in first, in the same browser!.<br/> " +
            "We will take you to the log in page in a few seconds...<br/>" +
            "After you log in, run the script again.");
        try {
            // "sleep" a bit, so we see the message
            await page.waitForSelector("#__inexistent__", {timeout: 10000});
        } catch (error) {
            // expected, didn't find, we can close the page
            page.goto('https://isa.epfl.ch/imoniteur_ISAP/isacademia.htm');
        }
        process.exit(1);
    } catch (error) {
        console.log("It seems you're logged in ! 👍");
    }

    const frame = page.frames().find(frame => frame.name() === "principal");
    // go to the "Gestion des stages (portail entreprise)"
    await XHRLoading(
        frame.click('td > a'),
    );
    console.log('Navigated to "Gestion des stages"');

    // get the internship table and click on the number of registered students, to see them all
    const internshipTablesSelector = 'table[name*=listeStage]';
    // NOTE: in my tests, this "wait for visible" does not work reliably. previous method was better
    const internshipTable = await getFirstVisible(page, internshipTablesSelector,
        "Found internship table");
    console.log('Going to registered students...')

    const registeredStudentsSelector = 'td:nth-of-type(5) > a'
    const registeredStudents = await internshipTable.$(registeredStudentsSelector);
    await XHRLoading(
        registeredStudents.click(),
    );

    // Unfortunately, the portal loads student pages dynamically via XHR requests
    // This means that when we access a student, we lose current context.
    // As such, we cannot iterate through the nice `students` table, as the elements are detached when we get back
    // => we iterate through integers, and re-select the table each time we come back to the page
    const registeredStudentsTablesSelector = 'table.prtl-se-Table.prtl-se-affichageListPostulants';
    const studentsSelector = 'td:first-of-type';
    let students = [];
    let currStudentIdx = 0;
    do {
        // const studentsTable = await page.waitForSelector(registeredStudentsTablesSelector, {visible: true});
        const studentsTable = await getFirstVisible(page, registeredStudentsTablesSelector);

        // first column has student name
        students = await studentsTable.$$(studentsSelector);
        const student = students[currStudentIdx];

        // enter student
        await XHRLoading(
            student.click()
        );
        const backToStudentsButton = await processStudent();

        // exit student
        await XHRLoading(
            backToStudentsButton.click(),
        );

        currStudentIdx++;
    } while (currStudentIdx < students.length);

    console.log('DONE 🎉');

    // without this, the script doesn't finish
    await browser.close();
})()
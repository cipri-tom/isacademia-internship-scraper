import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

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
    const page = pages[1];
    await page.setViewport({width: 1365, height: 1330}); // recommended to set some size
    await page.setDefaultTimeout(5000);

    // needed to download files
    const client = await page.target().createCDPSession();

    // When you're on mac and using proxy, this page takes AGES to load
    // most probably due to the proxy. The network request is pending, rather than stuck at the server
    // So, I run this through a tunnel to bypass the proxy
    // Update Oct 2023: it seems to work through the proxy now, no worries
    await page.goto('https://isa.epfl.ch/imoniteur_ISAP/isacademia.htm');
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
    await Promise.all([
        frame.click('td > a'),
        page.waitForNavigation(),
    ]);

    // click on the number of registered students, to see them all
    const internshipTablesSelector = 'table[name*=listeStage]';
    const internshipTables = await page.$$(internshipTablesSelector);
    console.log('Found %d internship tables, filtering for visible one...', internshipTables.length)
    let internshipTable = null;
    for (let table of internshipTables) {
        if (await table.boxModel()) {
            internshipTable = table;
            break;
        }
    }
    if (!internshipTable) {
        console.error('Could not find internship table');
        process.exit(1);
    }
    else {
        console.log('Found !')
    }

    console.log('Going to registered students...')

    const registeredStudentsSelector = 'td:nth-of-type(5) > a'
    const registeredStudents = await internshipTable.$(registeredStudentsSelector);
    await Promise.all([
        registeredStudents.click(),
        page.waitForNavigation(),
    ]);
    await XHR(); // after navigation, not at the same time

    const tables = await page.$$('table.prtl-se-Table.prtl-se-affichageListPostulants');
    console.log('Found %d tables with students. Filtering for visible ones', tables.length);

    const visibleTables = [];
    for (let table of tables) {
        const bm = await table.boxModel();
        // console.log(bm);
        if (bm)
            visibleTables.push(table);
    }
    console.log('Filtered down to %d visible tables of registered students', visibleTables.length);
    if (visibleTables.length !== 1) {
        console.error('Wrong... exiting');
        process.exit(1);
    }
    const table = visibleTables[0];

    const studentsSelector = 'td:first-of-type';
    const students = await table.$$(studentsSelector);
    console.log('Found %d students', students.length);


    for (let student of students) {
        // go to student
        await Promise.all([
            page.waitForNavigation(),
            student.click(),
        ])
        await XHR(); // after navigation, not at the same time


        // [ABANDONED]
        // Here I put a debugger to understand why the below did not work
        // it turns out that there is a frame in the page, so that I need to
        // search for the element in that frame, not in the parent page
        // at this point, I had run out of time and had to do it manually
        // await page.evaluate(() => { debugger; });

        // this is the iframe selector[id$=_900] > iframe
        // because there are many iframes, but the shown one is in a div that
        // ends with `_900`
        const studFrameElement = await page.$('[id$=_900] > iframe');
        let studFrame;
        if (!studFrameElement) {
            console.error('Could not find student frame', studFrameElement);
            process.exit(1);
        }
        else {
            console.log('Found student frame ! 🤞');
            studFrame = await studFrameElement.contentFrame();
        }
        await XHR();

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

        // return to list of students
        const returnButton = await studFrame.$('div.inscrstage-entr-retour a');
        await Promise.all([
            returnButton.click(),
            page.waitForNavigation(),
        ])
        await XHR();
    }



    // NO NEED to close the browser, it's the one we started on command line
    // await browser.close();
})()
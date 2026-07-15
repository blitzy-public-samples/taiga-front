/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

var argv = require('minimist')(process.argv.slice(2));
var child_process = require('child_process');
var inquirer = require("inquirer");
var Promise = require('bluebird');

// Legacy Protractor runner. Invoked via the `e2e:protractor` npm script
// (the `e2e` script now launches the Playwright harness instead). Example:
//   npm run e2e:protractor -- --s userStories,auth
var taigaBackPath = '';

// Suites retired when the Kanban and Backlog screens were migrated to the React
// + Playwright harness (`npm run e2e`). Their Protractor specs under
// e2e/suites/{kanban,backlog}.e2e.js were deleted and their conf.e2e.js
// mappings removed, so selecting them through this runner is an error and must
// be rejected rather than silently attempting to load a missing spec (F07).
var RETIRED_SUITES = ['backlog', 'kanban'];

var suites = [
    'auth',
    'public',
    'wiki',
    'admin',
    'issues',
    'epics',
    'tasks',
    'userProfile',
    'userStories',
    'home',
    'projectHome',
    'search',
    'team',
    'discover'
];

var lunchSuites = [];

if (argv.s) {
    // Normalise the comma-separated list (tolerating stray whitespace such as
    // "userStories, auth") and drop empty entries.
    suites = argv.s.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    // Reject any retired suite alias up front. These aliases used to map to the
    // now-deleted Kanban/Backlog Protractor specs; those screens are covered by
    // the Playwright harness (`npm run e2e`) instead (F07).
    var retired = suites.filter(function (s) { return RETIRED_SUITES.indexOf(s) !== -1; });
    if (retired.length) {
        console.error(
            'Error: the following Protractor suite(s) have been retired and migrated to the ' +
            'Playwright harness (run `npm run e2e`): ' + retired.join(', ') + '. ' +
            'Please remove them from the --s list; all other suites remain available.'
        );
        process.exit(1);
    }
}

function backup() {
    child_process.spawnSync('pg_dump', ['-c', '-d', 'taiga', '-f', 'tmp/taiga.sql'], {stdio: "inherit"});
}

function launchProtractor(suit) {
    let protractorParams = ['conf.e2e.js', '--suite=' + suit, '--back=' + taigaBackPath];

    var discard = [
        "_",
        "s",
        "a",
        "b"
    ];

    for(var arg in argv) {
        if (discard.indexOf(arg) === -1) {
            if(typeof argv[arg] === 'boolean') {
                protractorParams.push('--' + arg);
            } else {
                protractorParams.push('--' + arg + "=" + argv[arg]);
            }
        }
    }

    child_process.spawnSync('protractor', protractorParams, {stdio: "inherit"});
}

function restoreBackup() {
    child_process.spawnSync('psql', ['-d', 'taiga', '-f', 'tmp/taiga.sql']);
}

function ask() {
    return new Promise(function(resolve) {
        if (argv.a && suites.length) {
            inquirer.prompt([{
                type: 'list',
                name: 'next',
                message: 'Launch ' + suites[0] + '?',
                default: 'Yes',
                choices: [
                    'Yes',
                    'No'
                ]
            }], function( answers ) {
                if(answers.next === 'Yes') {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        } else if(suites.length) {
            resolve(true);
        } else {
            resolve(false);
        }
    });
}

async function launch () {
    backup();

    var next = true;

    while (next) {
        var suite = suites.shift();

        console.log('running: ' + suite);

        launchProtractor(suite);

        restoreBackup();

        next = await ask();
    }
}

if (argv.b) {
    taigaBackPath = argv.b;
    launch();
} else {
    inquirer.prompt([
        {
            type: 'string',
            name: 'back',
            message: 'Taiga back path'
        }
    ], function (answer) {
        taigaBackPath = answer.back;
        launch();
    });
}

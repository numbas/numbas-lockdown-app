const {app, autoUpdater, BrowserWindow, ipcMain, Menu, session, dialog, cookies, shell} = require('electron');
const minimist = require('minimist');
const eprompt = require('electron-prompt');
const Store = require('electron-store');
const menu = require('./menu.js');
const {make_key, decrypt_settings} = require('./decrypt_settings.js');
const path = require('path');
const url = require('url');

const store = new Store();

const VERSION = app.getVersion();
const {USER_AGENT, ABOUT_URL, AUTH_SERVER_WHITELIST, UPDATER_URL} = require('../config.js');

autoUpdater.setFeedURL(`${UPDATER_URL}/${process.platform}/${VERSION}`);

autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
    const dialogOpts = {
        type: 'info',
        buttons: ['Restart', 'Later'],
        title: 'Application Update',
        message: process.platform === 'win32' ? releaseNotes : releaseName,
        detail:
        'A new version has been downloaded. Restart the application to apply the updates.',
    }

    dialog.showMessageBox(dialogOpts).then((returnValue) => {
        if(returnValue.response === 0) {
            autoUpdater.quitAndInstall();
        }
    })
});

// The host of the LTI provider
let lti_host;

// The auth token we should send to the LTI provider
let lti_token;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

// If the app is used to open a numbas:// URL, store that URL here
let deeplinkingUrl;

if(!app.isPackaged) {
    /* When running the app in developer mode, argv looks like:
     * ['electron', '.', ...]
     * When running the built executable, it looks like:
     * ['numbas', ...]
     * To make them match up, if running the built executable, 
     * put null on the left of the list so the optional arguments always start at index 2.
     */
    process.argv.splice(0,1);
    process.argv = process.argv.filter(x => !x.startsWith('--'));
}
console.log(process.argv);

app.on('activate', function() {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    open_url([]);
  }
})


Menu.setApplicationMenu(Menu.buildFromTemplate(menu.template));
app.userAgentFallback = USER_AGENT+` (Version: ${VERSION}) (Platform: ${process.platform})`;

function set_lti_settings(settings) {
    const u = new URL(settings.url);
    lti_host = u.host;
    lti_token = settings.token;
}

function createWindow(init_url) {
    mainWindow = new BrowserWindow({
        title: 'Numbas',
        webPreferences: {
            devTools: false,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            enableRemoteModule: false,
            partition: 'persist:numbas',
            preload: path.join(__dirname, 'preload.js')
        }
    });

    if(init_url) {
        mainWindow.loadURL(init_url);
    }

    // Emitted when the window is closed.
    mainWindow.on('closed', function() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });

    mainWindow.maximize();

    return mainWindow;
}

ipcMain.on('toMain', (event, data) => {
    switch(data.command) {
        case 'openURL':
            shell.openExternal(data.url);
            break;
        case 'getCWD':
            mainWindow.webContents.send('fromMain', process.cwd());
            break;
    }
});

app.on('web-contents-created', (e,wc) => {
    /** 
     * For requests to the Numbas LTI tool,
     * send an Authorization header with the token from the launch settings
     */
    if(lti_host) {
        wc.session.webRequest.onBeforeSendHeaders(
            {
                urls: [
                    `http://${lti_host}/*`,
                    `https://${lti_host}/*`,
                    `ws://${lti_host}/*`,
                    `wss://${lti_host}/*`,
                ]
            },
            (details, callback) => {
                details.requestHeaders['Authorization'] = `Basic ${lti_token}`;
                callback({ requestHeaders: details.requestHeaders })
            }
        )
    }

    /** 
     * Handle the "preventunload" event
     */
    wc.on('will-prevent-unload', e => {
        const choice = dialog.showMessageBoxSync(
            BrowserWindow.fromWebContents(wc),
            {
                type: 'warning',
                buttons: ['Cancel','Yes'],
                defaultId: 0,
                cancelId: 0,
                message: 'Are you sure you want to close this window? You will lose any unsaved data.'
            }
        );
        if(choice == 1) {
            e.preventDefault();
        }
    });
});

/**
 * Just before closing the app, make sure all cookies are written to disk.
 */
app.on('window-all-closed', () => {
    const ses = session.fromPartition('persist:numbas');
    ses.cookies.flushStore(()=>{});
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.setAsDefaultProtocolClient('numbas');

async function open_url(cli_options) {
    const url = cli_options[0];
    if(url === undefined) {
        open_local_page('no_command.html');
        return;
    }

    const purl = new URL(url);
    let init_url;
    if(purl.protocol == 'numbas:') {
        const host = purl.host;
        var init_password = store.get('decrypt_password','');

        const data = purl.pathname.slice(1);
        const iv = Uint8Array.from(Buffer.from(data.slice(0,32),'hex'));
        const encrypted = data.slice(32);

        function use_password(password) {
            const key = make_key(password);
            const settings = decrypt_settings(key,iv,encrypted);
            init_url = settings.url;
            set_lti_settings(settings);
            if(settings.user_agent) {
                set_user_agent(settings.user_agent);
            }
            createWindow(init_url);
            return settings;
        }

        try {
            use_password('');
            return;
        } catch(e) {}

        try {
            use_password(init_password);
            return;
        } catch(e) {}

        const password = await eprompt({
            title: 'Numbas - Enter password',
            label: 'Please enter the password for this link',
            value: init_password,
            inputAttrs: {
                type: 'string'
            },
            type: 'input'
        });
        if(password===null) {
            process.exit(0);
            return;
        }
        try {
            use_password(password);
            store.set('decrypt_password',password);
        } catch(e) {
            console.error(e);
            open_local_page('bad_decrypt.html');
            return;
        }
    } else {
        init_url = url;
        createWindow(init_url);
    }
}

function open_local_page(name) {
    const w = createWindow();
    const root = app.isPackaged ? path.resolve(process.resourcesPath,'..') : '.';
    w.loadFile(path.resolve(root,'html',name));
    w.setMenu(null);
}

function init_session() {
    const ses = session.fromPartition('persist:numbas');
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
        return callback(false);
    });

    session.defaultSession = ses;
}

async function init() {
    init_session();

    await open_url(process.argv.slice(1));
}

app.on('ready', init);

app.on('will-finish-launching', function() {
    app.on('open-url', (event, url) => {
        event.preventDefault();
        open_url([url]);
    })
})

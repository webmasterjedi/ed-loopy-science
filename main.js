// Modules to control application life and create native browser window
const {app, BrowserWindow, ipcMain, dialog} = require('electron');
if (require('electron-squirrel-startup')) {
  return app.quit();
}

const path = require('path');
const fs = require('fs');
const db_dir = 'db/';
const config_db = path.join(__dirname, db_dir, 'config.json');
let config = {
  journal_path: '',
  streamer_mode: false,
  auto_scan: false,
  window_size: {},
};
let loopy_window;
let start_width = 666;
let start_height = 666;
let start_x;
let start_y;

function readConfig() {
  // read & parse JSON object from file
  //return db
  try {
    const file_contents = fs.readFileSync(config_db, {encoding: 'utf-8', flag: 'r'});
    return JSON.parse(file_contents.toString());
  }
  catch (err) {
    console.error(err);
    return writeConfig(config)
  }
}

function writeConfig(data) {
  // read JSON object from file
  // convert JSON object to string
  const to_json = JSON.stringify(data);
// write JSON string to a file
  try {
    fs.writeFileSync(config_db, to_json);

  }
  catch (err) {
    console.error(err);
  }
  return readConfig();
}

function createWindow() {
  //setup config for window
  let window_config = {
    width: start_width,
    height: start_height,
    webPreferences: {
      enableRemoteModule: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  };
  //if we have a saved position
  if (typeof start_x !== 'undefined' && typeof start_y !== 'undefined') {
    window_config['x'] = start_x;
    window_config['y'] = start_y;
  }

  // Create the browser window.
  const main_window = new BrowserWindow(window_config);

  // and load the index.html of the app.
  main_window.loadFile('index.html');

  // Open the DevTools.
  main_window.webContents.openDevTools()
  return main_window;
}

ipcMain.on('openDirectory', function(event, ...args) {
  console.log('click');
  //show open dialog
  event.returnValue = dialog.showOpenDialogSync({
    properties: ['openDirectory'],
  });
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  config = readConfig();
  if (typeof config.window_size === 'object' &&
      (config.window_size.start_width !== start_width ||
          config.window_size.start_height !== start_height)) {
    start_width = config.window_size.start_width;
    start_height = config.window_size.start_height;
  }
  if (typeof config.window_pos === 'object' &&
      (config.window_pos.start_x !== start_x ||
          config.window_pos.start_y !== start_y)) {
    start_x = config.window_pos.start_x;
    start_y = config.window_pos.start_y;
  }
  loopy_window = createWindow();

  app.on('activate', function() {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      loopy_window = createWindow();
    }
  });
  loopy_window.on('resized', function() {
    config = readConfig();
    console.log(config);
    if (typeof config.window_size !== 'object') {
      config['window_size'] = {
        start_width: 0,
        start_height: 0,
      };

    }
    const new_size = loopy_window.getBounds();
    config.window_size.start_width = new_size.width;
    config.window_size.start_height = new_size.height;
    console.log(config);

    writeConfig(config);
  });
  loopy_window.on('moved', function() {
    config = readConfig();
    console.log(config);
    if (typeof config.window_pos !== 'object') {
      config['window_pos'] = {
        start_x: 0,
        start_y: 0,
      };

    }
    const new_bounds = loopy_window.getBounds();
    console.log(new_bounds);
    config.window_pos.start_x = new_bounds.x;
    config.window_pos.start_y = new_bounds.y;
    console.log(config);

    writeConfig(config);
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function() {

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

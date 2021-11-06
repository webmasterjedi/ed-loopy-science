// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
require('popper.js');
require('bootstrap');

const { contextBridge, ipcRenderer } = require("electron");
const {$} = require('jquery');

contextBridge.exposeInMainWorld("ipcRenderer", {ipcRenderer});

function chooseDirectory() {
  ipcRenderer.send('openDirectory', {});
  console.log("wtf?");
}

window.addEventListener('DOMContentLoaded', () => {
  
  let button = $('#ChooseDirectory').on('click',chooseDirectory)
})

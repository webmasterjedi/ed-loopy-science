// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ipcRenderer', { ipcRenderer })

function chooseDirectory () {
  return  ipcRenderer.sendSync('openDirectory', {})
}

window.addEventListener('DOMContentLoaded', () => {
  window.$ = window.jQuery = require('jquery')
  let button = $('#ChooseDirectoryButton').on('click', () => {
    let journal_path = chooseDirectory()
    console.log(journal_path)
  })
})

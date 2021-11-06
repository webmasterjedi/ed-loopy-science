// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const LineByLineReader = require('line-by-line')

let star_types = []
let star_type = ''
let stars_by_systems = []
let body_count = []
let file_count = 2
let files_total = 0
contextBridge.exposeInMainWorld('ipcRenderer', { ipcRenderer })

function chooseDirectory () {
  return ipcRenderer.sendSync('openDirectory', {})
}

function getStarIdFromPlanetsParents (parents) {
  if (typeof parents !== 'object') {
    return null
  }
  let parent_id = null
  parents.every(parent => {
    if (parent.hasOwnProperty('Star')) {
      parent_id = parent['Star'];
      return false;
    }
    return true;
  })
  return parent_id
}

function readJournalLineByLine (file) {

  let lr = new LineByLineReader(file)

  lr.on('error', function (err) {
    // 'err' contains error object
    console.log(err)
  })
  lr.on('line', function (line) {
    // 'line' contains the current line without the trailing newline character.
    let entry_decoded
    if (!entry_decoded) {
      try {
        entry_decoded = JSON.parse(line)
      } catch (e) {
        entry_decoded = null
      }
    }

    if (entry_decoded && ((entry_decoded['event'] !== 'Scan') ||
      (typeof entry_decoded['ScanType'] !== 'undefined' &&
        entry_decoded['ScanType'] === 'NavBeaconDetail'))) {
      entry_decoded = null
    }
    if (entry_decoded && entry_decoded.hasOwnProperty('BodyName') &&
      body_count.hasOwnProperty(entry_decoded['BodyName'])) {
      entry_decoded = null
    }

    if (entry_decoded) {
      let star_system = entry_decoded['StarSystem']
      body_count[entry_decoded['BodyName']] = entry_decoded['BodyName']

      if (entry_decoded.hasOwnProperty('ScanType') &&
        entry_decoded.hasOwnProperty('Luminosity') &&
        entry_decoded.hasOwnProperty('Subclass')) {
        star_type = entry_decoded['StarType'] +
          entry_decoded['Subclass'] + ' ' + entry_decoded['Luminosity']
        if (!stars_by_systems.hasOwnProperty(star_system)) {
          stars_by_systems[star_system] = {}
        }
        stars_by_systems[star_system][entry_decoded['BodyID']] = star_type

        if (!star_types.hasOwnProperty(star_type)) {
          star_types[star_type] = {
            'Earthlike body':
              0,
            'Ammonia world':
              0,
            'Water world':
              0,
          }
        }
      }

      let planet_type = 0
      if (entry_decoded.hasOwnProperty('PlanetClass')) {
        switch (entry_decoded['PlanetClass']) {
          case 'Earthlike body' :
          case 'Ammonia world' :
          case 'Water world' :
            planet_type = entry_decoded['PlanetClass']
            break
        }
      }
      if (planet_type) {
        let planets_star_id

        planets_star_id = getStarIdFromPlanetsParents(entry_decoded['Parents'])
        //console.log(planets_star_id)
        if (planets_star_id) {
          if (typeof stars_by_systems[star_system][planets_star_id] !==
            'undefined') {
            star_type = stars_by_systems[star_system][planets_star_id]

          } else {
            star_type = stars_by_systems[star_system][1]
          }
          star_types[star_type][planet_type]++
        }

      }
    }
  })
  lr.on('end', function () {
    file_count++;
    console.log(file_count,files_total)
    if(file_count >= files_total){
      outputResults()
    }
    // All lines are read, file is closed now.
  })

}

function outputResults () {
  console.log('foo')
  Object.entries(star_types).forEach(entry => {
    const [star_type, planets] = entry
    let new_row = $('<tr data-star-type="${star_type}">')
    new_row.append(`<td>${star_type}</td>`)

    Object.entries(planets).forEach(planet => {
      let [planet_type, count] = planet
      count = count ?? 0
      new_row.append(`<td data-count="${count}">${count}</td>`)
    })
    $('#ResultsContainer').append(new_row)
  })
}

function getJournalFiles (journal_path) {
  fs.readdir(journal_path, (err, files) => {
    if (err)
      console.log(err)
    else {
      files_total = files.length;
      files.forEach(file => {
        if (path.extname(file) === '.log') {

          //Todo: Process file line by line
          //console.log(file)
          let journal_item = $('' +
            '<li class="list-group-item">' +
            '<i class="fad fa-atlas"></i><span class="file-name ms-3"></span>' +
            '</li>')
          journal_item.find('span.file-name').text(file)
          //$('#JournalList').append(journal_item)

          readJournalLineByLine(journal_path + '\\' + file)

        } else {
          files_total--
        }

      })
    }
  })

}

window.addEventListener('DOMContentLoaded', () => {
  window.$ = window.jQuery = require('jquery')
  let button = $('#ChooseDirectoryButton').on('click', () => {
    let journal_path = chooseDirectory()
    if (journal_path) {
      $('#DirectoryPathPreview').val(journal_path[0])
      getJournalFiles(journal_path[0])
    }
  })
})

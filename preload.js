// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const LineByLineReader = require('line-by-line')
const Console = require('console')

let star_types = []
let star_type = ''
let stars_by_systems = []
let body_count = []
let journal_path = ''
let file_count = 2
let files_total = 0
contextBridge.exposeInMainWorld('ipcRenderer', { ipcRenderer })

function sortObjectByKeys (obj) {
  return Object.keys(obj).sort().reduce(function (result, key) {
    result[key] = obj[key]
    return result
  }, {})
}

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
      parent_id = Number(parent['Star'])
      return false
    }
    return true
  })
  return parent_id
}

function readJournalLineByLine (file) {

  let lr = new LineByLineReader(journal_path + '\\' + file)

  lr.on('error', function (err) {
    // 'err' contains error object
    console.log(err)
  })
  lr.on('line', function (line) {

    //Parse JSON from Journal file
    let entry_decoded
    if (!entry_decoded) {
      try {
        entry_decoded = JSON.parse(line)
      } catch (e) {
        entry_decoded = null
        return false
      }
    }
    //check for the type of scan we need
    if (entry_decoded && ((entry_decoded['event'] !== 'Scan') ||
      (typeof entry_decoded['ScanType'] !== 'undefined' &&
        entry_decoded['ScanType'] === 'NavBeaconDetail'))) {
      return false
    }

    if (entry_decoded && entry_decoded.hasOwnProperty('BodyName') &&
      body_count.hasOwnProperty(entry_decoded['BodyName'])) {
      entry_decoded = null
      return false
    }

    if (entry_decoded) {
      let star_system = entry_decoded['StarSystem']
      body_count[entry_decoded['BodyName']] = entry_decoded['BodyName']
      //checks to make sure scan is a star
      if (entry_decoded.hasOwnProperty('ScanType') &&
        entry_decoded.hasOwnProperty('Luminosity') &&
        entry_decoded.hasOwnProperty('Subclass')) {
        star_type = entry_decoded['StarType'] +
          entry_decoded['Subclass'] + ' ' + entry_decoded['Luminosity']
        if (!stars_by_systems.hasOwnProperty(star_system)) {
          stars_by_systems[star_system] = {}
        }
        let body_id = Number(entry_decoded['BodyID'])
        //console.log(body_id)
        stars_by_systems[star_system][body_id] = star_type
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
        if (planets_star_id !== null) {

          if (stars_by_systems.hasOwnProperty(star_system) &&
            typeof stars_by_systems[star_system][planets_star_id] !==
            'undefined') {
            //console.log('Sys:', stars_by_systems[star_system])
            star_type = stars_by_systems[star_system][planets_star_id]

          } else if (stars_by_systems.hasOwnProperty(star_system)) {
            console.log('Parent Body:', stars_by_systems[star_system])
            //console.log(stars_by_systems[star_system])
            star_type = stars_by_systems[star_system][1]
          }
          if (star_types.hasOwnProperty(star_type)) {
            star_types[star_type][planet_type]++
          }

        }

      }
    }
  })
  lr.on('end', function () {
    file_count++

    let journal_item = $('' +
      '<li class="list-group-item">' +
      '<i class="fad fa-atlas"></i><span class="file-name ms-3"></span><span class="ms-4 text-success"><i class="fas fa-check"></i></span>' +
      '</li>')
    journal_item.find('span.file-name').text(file)
    $('#JournalList').append(journal_item)
    //console.log (file_count , files_total)
    if (file_count >= files_total) {
      setTimeout(outputResults, 1000)

    }
    // All lines are read, file is closed now.
  })

}

function outputResults () {

  star_types = sortObjectByKeys(star_types)
  Object.entries(star_types).forEach(entry => {
    const [star_type, planets] = entry
    let new_row = $('<tr data-star-type="${star_type}">')
    new_row.append(`<td>${star_type}</td>`)

    Object.entries(planets).forEach(planet => {
      let [planet_type, count] = planet
      new_row.append(`<td data-count="${count}">${count}</td>`)
    })
    $('#ResultsContainer').append(new_row)
  })
  $('[data-step="1"]').removeClass('d-flex').slideUp()
  $('[data-step="2"]').slideUp().slideDown()
}

function getJournalFiles () {
  fs.readdir(journal_path, (err, files) => {
    if (err)
      console.log(err)
    else {
      files_total = files.length
      files.forEach(file => {
        if (path.extname(file) === '.log') {
          readJournalLineByLine(file)
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
    journal_path = chooseDirectory()[0]
    if (journal_path) {
      $('#DirectoryPathPreview').val(journal_path)
      getJournalFiles()
    }
  })
})

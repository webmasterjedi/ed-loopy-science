// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const LineByLineReader = require('line-by-line')
const Console = require('console')

let star_types = []
let top_star_types = {
  'Earthlike body':
    0,
  'Ammonia world':
    0,
  'Water world':
    0,
}
let star_type = ''
let stars_by_systems = []
let planet_totals = []
let body_count = []
let journal_path = ''
let file_count = 0
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

function processJournalEvent (entry_decoded) {
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
        star_type = stars_by_systems[star_system][1]
      }
      if (star_types.hasOwnProperty(star_type)) {
        star_types[star_type][planet_type]++
        if (typeof planet_totals[planet_type] === 'undefined') {
          planet_totals[planet_type] = 0
        }
        planet_totals[planet_type]++
      }
    }
  }
}

function readJournalLineByLine (file) {
  let logPath = journal_path + '\\' + file
  let lr = new LineByLineReader(logPath)

  lr.on('error', function (err) {
    // 'err' contains error object
    console.log(err)
  })
  lr.on('line', function (line) {
    //Parse JSON from Journal file
    let entry_decoded
    if (!entry_decoded) {
      try {
        processJournalEvent(JSON.parse(line))

      } catch (e) {
        entry_decoded = null
        return false
      }
    }
  })
  lr.on('end', function () {
    file_count++
    console.log('hello')
// All lines are read, file is closed now.
    let journal_item = $('' +
      '<li class="list-group-item">' +
      '<i class="fad fa-atlas"></i><span class="file-name ms-3"></span><span class="ms-4 text-success"><i class="fas fa-check"></i></span>' +
      '</li>')
    journal_item.find('span.file-name').text(file)
    $('#JournalList').append(journal_item)

    console.log(file_count, files_total)
    if (file_count >= files_total) {

      setTimeout(outputResults, 1000)

    }
  })

}

function outputResults () {
  console.log('outputting results')
  star_types = sortObjectByKeys(star_types)
  console.log(star_types)
  console.log(planet_totals)
  let current_count = {
    'Earthlike body':
      0,
    'Ammonia world':
      0,
    'Water world':
      0,
  }
  Object.entries(star_types).forEach(entry => {
    const [star_type, planets] = entry
    let new_row = $('<tr data-star-type="${star_type}">')
    new_row.append(`<td>${star_type}</td>`)

    Object.entries(planets).forEach(planet => {
      let [planet_type, count] = planet
      if (count > current_count[planet_type]) {
        current_count[planet_type] = count
        top_star_types[planet_type] = star_type
      }
      new_row.append(`<td data-planet-type="${planet_type}" data-count="${count}">${count}</td>`)
    })
    $('#ResultsContainer').append(new_row)
  })
  Object.entries(planet_totals).forEach(planet => {
    let [planet_type, count] = planet
    console.log(planet_type, count)
    $('.planet-total[data-type="' + planet_type + '"]').
      find('span.total').
      text(count).parent().find('h4').text(top_star_types[planet_type])

  })

  $('[data-step="1"]').removeClass('d-flex').slideUp()
  $('[data-step="2"]').slideUp().slideDown()
  console.log(top_star_types)
}

function getTotalLogsCount (files) {
  let total = 0
  files.forEach(file => {
    if (path.extname(file) === '.log') {
      total++
    }
  })
  return total
}

function getJournalFiles () {
  fs.readdir(journal_path, (err, files) => {
    if (err)
      console.log(err)
    else {
      files_total = getTotalLogsCount(files)
      files.forEach(file => {
        if (path.extname(file) === '.log') {
          readJournalLineByLine(file)
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

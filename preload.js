// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LineByLineReader = require('line-by-line')
const config = path.join(__dirname, 'config.json')
const star_db = path.join(__dirname, 'stars_db.json')
const journals_db = path.join(__dirname, 'journals_db.json')

let processed_journals = []
let star_types = []
let star_cache = []
let body_cache = []
let stars_by_systems = []
let planet_totals = []
let body_count = []

let journal_path = ''
let file_count = 0
let files_total = 0
let processing_bodies = 0

function readDB (db) {
  // read & parse JSON object from file
  //return db
  try {
    return JSON.parse(
      fs.readFileSync(db, { encoding: 'utf-8', flag: 'r' }).toString())
  } catch (err) {
    console.log(err, db)
    return writeDB(db, [])
  }
}

function writeDB (db, data) {
  // read JSON object from file
  // convert JSON object to string
  data = JSON.stringify(data)

// write JSON string to a file
  try {
    fs.writeFileSync(db, data)

  } catch (err) {
    console.error(err)
  }
  return readDB(db)
}

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

function letterToNumber (letter) {
  return parseInt(letter, 36) - 9
}

function catalogStarType (body_id, star_system, star_type) {

  if (!stars_by_systems.hasOwnProperty(star_system)) {

    stars_by_systems[star_system] = {}
  }

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
  star_cache = star_cache.filter((v) => {return v !== star_system + body_id})
  checkStarProgress()
}

function catalogBody (entry_decoded) {
  /*Planet Events*/
  let planet_type = 0
  let star_system = undefined
  let star_type
  if (entry_decoded.hasOwnProperty('PlanetClass')) {
    if (typeof star_system === 'undefined' ||
      typeof entry_decoded['StarSystem'] === 'undefined') {
      //convert body name to array
      star_system = detectStarSystemByBody(entry_decoded['BodyName'])
      if (star_system === null) {
        return null
      }
    }

    switch (entry_decoded['PlanetClass']) {
      case 'Earthlike body' :
      case 'Ammonia world' :
      case 'Water world' :
        planet_type = entry_decoded['PlanetClass']
        break
    }
    if (planet_type) {
      let planets_star_id

      planets_star_id = getStarIdFromPlanetsParents(entry_decoded['Parents'])

      if (planets_star_id !== null) {

        if (stars_by_systems.hasOwnProperty(star_system) &&
          typeof stars_by_systems[star_system][planets_star_id] !==
          'undefined') {

          star_type = stars_by_systems[star_system][planets_star_id]

        } else if (stars_by_systems.hasOwnProperty(star_system)) {
          star_type = stars_by_systems[star_system][1]
        }

        if (star_types.hasOwnProperty(star_type)) {
          star_types[star_type][planet_type]++
        }
      } else {
        //barycenter
        //if no system name in codex

        let barycenter_stars_output = 'Barycenter ('
        let barycenter_code = entry_decoded['BodyName'].replace(
          star_system + ' ',
          '').replace(/[0-9]/g, '').replace(' ', '')
        let barycenter_stars = []
        $.each(barycenter_code.split(''), function (index, value) {
          const num_from_letter = letterToNumber(value) - 1
          let possible_star_types = Object.values(stars_by_systems[star_system])
          barycenter_stars.push(possible_star_types[num_from_letter])
        })

        barycenter_stars_output += barycenter_stars.toString() + ')'
        if (!star_types.hasOwnProperty(barycenter_stars_output)) {
          star_types[barycenter_stars_output] = {
            'Earthlike body':
              0,
            'Ammonia world':
              0,
            'Water world':
              0,
          }
        }
        star_types[barycenter_stars_output][planet_type]++
      }
    }
  }
}

function detectStarSystemByBody (body_name) {
  let detected_system_name = null
  Object.entries(stars_by_systems).forEach(system => {
    let [system_name] = system
    if (body_name.match(system_name)) {
      return detected_system_name = system_name
    }
  })
  if (detected_system_name === null) {
    console.log('Couldnt detect:', stars_by_systems, body_name)
    return null
  }
  return detected_system_name
}

function checkStarProgress () {
  if (file_count >= files_total && !star_cache.length && !processing_bodies) {
    processBodyCache()
  }
}

function processBodyCache () {
  processing_bodies = 1
  if (!body_cache.length) {
    setTimeout(outputResults, 150)
    return true
  }
  $.each(body_cache, function (index, entry) {

    catalogBody(entry)
    if (index >= body_cache.length - 1) {
      setTimeout(outputResults, 150)
      return true
    }
  })
  return true
}

function processJournalEvent (entry_decoded, file) {
  let star_type
  let star_system
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

  star_system = entry_decoded['StarSystem']
  body_count[entry_decoded['BodyName']] = entry_decoded['BodyName']
  /*Star Entries*/
  //checks to make sure scan is a star
  if (entry_decoded.hasOwnProperty('ScanType') &&
    entry_decoded.hasOwnProperty('Luminosity') &&
    entry_decoded.hasOwnProperty('Subclass')) {
    let body_id = Number(entry_decoded['BodyID'])

    if (typeof star_system === 'undefined' ||
      typeof entry_decoded['StarSystem'] === 'undefined') {
      return false
      //gets star system name if missing. hacky as fuck
      //convert body name to array
      let body_name = entry_decoded['BodyName']
      //remove last letters if has parents
      if (typeof entry_decoded['Parents'] !== 'undefined') {
        body_name = body_name.split(' ')
        body_name.pop()
        body_name = body_name.join(' ')
      }
      star_system = body_name
    }

    let subclass = entry_decoded['Subclass']
    if (typeof subclass === 'undefined') {
      return false
    }
    star_cache.push(star_system + body_id)
    star_type = entry_decoded['StarType'] + subclass + ' ' +
      entry_decoded['Luminosity']
    catalogStarType(body_id, star_system, star_type)
    return true
  }
  /*Bodies*/
  else {
    if (entry_decoded.hasOwnProperty('PlanetClass')) {
      if (entry_decoded['PlanetClass'] === 'Earthlike body' ||
        entry_decoded['PlanetClass'] === 'Ammonia world' ||
        entry_decoded['PlanetClass'] === 'Water world') {

        cacheBody(entry_decoded)
        return true
      }
    }
  }
  return true
}

function cacheBody (entry_decoded) {
  body_cache.push(entry_decoded)
}

function readJournalLineByLine (file) {
  let logPath = journal_path + '\\' + file
  let lr = new LineByLineReader(logPath, {
    encoding: 'utf8',
    skipEmptyLines: true,
  })

  lr.on('error', function (err) {
    // 'err' contains error object
    console.log(err)
  })
  lr.on('line', function (line) {
    //Parse JSON from Journal file
    let entry_decoded
    if (!entry_decoded) {
      try {
        return processJournalEvent(JSON.parse(line))
      } catch (e) {
        console.error(e)
        entry_decoded = null
        return false
      }
    }
  })
  lr.on('end', function () {

// All lines are read, file is closed now.
    let journal_item = $('' +
      '<li class="list-group-item bg-transparent text-light">' +
      '<i class="fas fa-atlas"></i><span class="file-name ms-3"></span><span class="ms-4 text-success"><i class="fas fa-check"></i></span>' +
      '</li>')
    journal_item.find('span.file-name').text(file)
    $('#JournalList').append(journal_item)
    var listHistory = document.getElementById('JournalList')
    listHistory.scrollTop = listHistory.scrollHeight
    processed_journals.push(file)
    file_count++
    checkStarProgress()
  })

}

function compare (idx) {
  return function (a, b) {
    let A = tableCell(a, idx), B = tableCell(b, idx)
    return $.isNumeric(A) && $.isNumeric(B) ?
      A - B : A.toString().localeCompare(B)
  }
}

function tableCell (tr, index) {
  return $(tr).children('td').eq(index).text()
}

function setIcon (element, inverse) {

  var iconSpan = $(element).find('[data-fa-i2svg]')

  if (inverse == false) {
    $(iconSpan).
      removeClass('fa-sort').
      removeClass('fa-sort-down').
      addClass('fa-sort-up')

  } else {
    $(iconSpan).
      removeClass('fa-sort').
      removeClass('fa-sort-up').
      addClass('fa-sort-down')
  }
  $(element).
    siblings().
    find('[data-fa-i2svg]').
    removeClass('fa-sort-down').
    removeClass('fa-sort-up').
    addClass('fa-sort')
}

function outputResults () {
  let current_count = {
    'Earthlike body':
      0,
    'Ammonia world':
      0,
    'Water world':
      0,
  }
  star_types = sortObjectByKeys(star_types)
  Object.entries(star_types).map(entry => {

    const [star_type, planets] = entry

    if (!planets['Earthlike body'] && !planets['Ammonia world'] &&
      !planets['Water world']) {
      return false
    }
    let new_row = $(`<tr class="star-data-row" data-star-type="${star_type}">`)
    new_row.append(`<td>${star_type}</td>`)

    Object.entries(planets).map(planet => {

      const [planet_type, count] = planet

      if (typeof planet_totals[planet_type] === 'undefined') {
        planet_totals[planet_type] = 0
      }

      planet_totals[planet_type] += count

      new_row.append(
        `<td data-planet-type="${planet_type}" data-count="${count}">${count}</td>`)
      return true
    })
    $('#ResultsContainer').append(new_row)
    return true
  })
  Object.entries(planet_totals).forEach(planet => {
    const [planet_type, count] = planet
    $('.planet-total[data-type="' + planet_type + '"]').
      find('span.total').
      text(count)
  })

  $('th.sortable').click(function (e) {
    const table = $(this).parents('table').eq(0)
    let ths = table.find('tr:gt(0)').toArray().sort(compare($(this).index()))
    this.asc = !this.asc
    if (!this.asc)
      ths = ths.reverse()
    for (var i = 0; i < ths.length; i++)
      table.append(ths[i])
    setIcon(e.target, this.asc)
  })

  $('[data-step="1"]').removeClass('d-flex').slideUp()
  $('[data-step="2"]').slideUp().slideDown()
  //write to file
  writeDB(star_db, star_types)
  writeDB(journals_db, processed_journals)
}

function getTotalLogsCount (files) {
  let total = 0
  files.forEach(file => {
    if (!processed_journals.includes(file) && path.extname(file) === '.log') {
      total++
    }
  })
  return total
}

function processJournals () {
  fs.readdir(journal_path, (err, files) => {
    if (err) {
      console.log(err)
      return false
    }
    files_total = getTotalLogsCount(files)
    if (files_total) {
      files.forEach(file => {
        if (!processed_journals.includes(file) && path.extname(file) ===
          '.log') {
          readJournalLineByLine(file)
        }
      })
      return true
    }

    if (Object.entries(star_types).length) {
      setTimeout(outputResults, 150)
    }
  })
}

/*bring in jQuery (fuck the haters or am I trolling?)*/
window.addEventListener('DOMContentLoaded', () => {
  window.$ = window.jQuery = require('jquery')
  journal_path = os.homedir() +
    '\\Saved Games\\Frontier Developments\\Elite Dangerous'
  $('#DirectoryPathPreview').val(journal_path)
  star_types = readDB(star_db)
  processed_journals = readDB(journals_db)
  setTimeout(processJournals,100)
})

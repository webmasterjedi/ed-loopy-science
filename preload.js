// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const moment = require('moment')
const LineByLineReader = require('line-by-line')
const config = path.join(__dirname, 'config.json')
const star_db = path.join(__dirname, 'stars_db.json')
const journals_db = path.join(__dirname, 'journals_db.json')
const local_moment = moment()
let processed_journals = []
let currently_watching = false
let star_types = []
let star_cache = []
let body_cache = []
let stars_by_systems = []
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
  console.log(
    file_count >= files_total && !star_cache.length && !processing_bodies,
    file_count, files_total, star_cache.length, processing_bodies)
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
      console.log('done')
      setTimeout(outputResults, 150)
      return true
    }
  })
  return true
}

function processJournalEvent (entry_decoded) {
  let star_type
  let star_system
  if (entry_decoded && entry_decoded['event'] === 'Shutdown') {
    return true
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
    return false
  }
  /*Bodies*/
  else {
    if (entry_decoded.hasOwnProperty('PlanetClass')) {
      if (entry_decoded['PlanetClass'] === 'Earthlike body' ||
        entry_decoded['PlanetClass'] === 'Ammonia world' ||
        entry_decoded['PlanetClass'] === 'Water world') {

        cacheBody(entry_decoded)
        return false
      }
    }
  }
  return false
}

function cacheBody (entry_decoded) {
  body_cache.push(entry_decoded)
}

function readJournalLineByLine (file) {
  let logPath = journal_path + '\\' + file
  let completeFile = false
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
        completeFile = processJournalEvent(JSON.parse(line))
      } catch (e) {
        console.error(e)
        entry_decoded = null
        return false
      }
    }
  })
  lr.on('end', function () {
    file_count++
// All lines are read, file is closed now.
    let journal_item = $('' +
      '<li class="list-group-item bg-transparent text-light">' +
      '<i class="fas fa-atlas"></i><span class="file-name ms-3"></span><span class="ms-4 text-success"><i class="fas fa-check"></i></span>' +
      '</li>')
    journal_item.find('span.file-name').text(file)
    $('#JournalList').append(journal_item)
    const listHistory = document.getElementById('JournalList')
    listHistory.scrollTop = listHistory.scrollHeight

    const mtime = moment(fs.statSync(journal_path + '/' + file).mtime)
    checkStarProgress()
    if (!currently_watching && local_moment.diff(mtime, 'days') === 0) {
      console.log('Todays Log found', file)
      currently_watching = journal_path + '/' + file
      return true
    }

    processed_journals.push(file)

    return true
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
  let planet_totals = []

  star_types = sortObjectByKeys(star_types)
  $('#ResultsContainer').html('')
  Object.entries(star_types).forEach(entry => {

    let [star_type, planets] = entry

    if (!planets['Earthlike body'] && !planets['Ammonia world'] &&
      !planets['Water world']) {
      return false
    }
    if (star_type === 'N0 VII') {
      star_type = 'Neutron'
    }
    let new_row = $(`<tr class="star-data-row" data-star-type="${star_type}">`)
    new_row.append(`<td>${star_type}</td>`)

    Object.entries(planets).forEach(planet => {
      let [planet_type, count] = planet
      if (typeof planet_totals[planet_type] === 'undefined') {
        planet_totals[planet_type] = 0
      }

      planet_totals[planet_type] += count

      new_row.append(
        `<td data-planet-type="${planet_type}" data-count="${count}">${count}</td>`)
    })
    $('#ResultsContainer').append(new_row)
  })
  Object.entries(planet_totals).forEach(planet => {
    let [planet_type, count] = planet
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
  if (currently_watching) {
    //enable watch trigger
    $('#EnableWatch').show().on('click', (e) => {
      $(this).html('<i class="fas fa-book-reader me-2"></i> Auto Watch is on <i class="fas fa-check"></i>').off('click')
      watchAndProcess(currently_watching)
    })
  }
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

let fileSize

function watchAndProcess (journal_file) {

  currently_watching = journal_file
// Obtain the initial size of the log file before we begin watching it.
  fileSize = fs.statSync(journal_file).size
  fs.watchFile(journal_file, function (current, previous) {
    // Check if file modified time is less than last time.
    // If so, nothing changed so don't bother parsing.
    if (current.mtime <= previous.mtime) { return }

    // We're only going to read the portion of the file that
    // we have not read so far. Obtain new file size.
    const newFileSize = fs.statSync(journal_file).size
    // Calculate size difference.
    let sizeDiff = newFileSize - fileSize
    // If less than zero then Hearthstone truncated its log file
    // since we last read it in order to save space.
    // Set fileSize to zero and set the size difference to the current
    // size of the file.
    if (sizeDiff < 0) {
      fileSize = 0
      sizeDiff = newFileSize
    }
    // Create a buffer to hold only the data we intend to read.
    const buffer = Buffer.alloc(sizeDiff)
    // Obtain reference to the file's descriptor.
    const fileDescriptor = fs.openSync(journal_file, 'r')
    // Synchronously read from the file starting from where we read
    // to last time and store data in our buffer.
    fs.readSync(fileDescriptor, buffer, 0, sizeDiff, fileSize)
    fs.closeSync(fileDescriptor) // close the file
    // Set old file size to the new size for next read.
    fileSize = newFileSize

    // Parse the line(s) in the buffer.
    //console.log(buffer.toString())
    parseBuffer(buffer)
  })

}

function stopWatchAndProcess () {
  fs.unwatchFile(currently_watching)
}

function parseBuffer (buffer) {
  // Iterate over each line in the buffer.
  buffer.toString().split(os.EOL).forEach(function (line) {
    // Do stuff with the line :)
    if (line.length) {
      let lineJSON = JSON.parse(JSON.parse(JSON.stringify(line)))
      console.log(lineJSON)
      if (processJournalEvent(lineJSON)) {
        console.log('stop watching, and mark as processed')
        stopWatchAndProcess(currently_watching)
        processed_journals.push(currently_watching)
        writeDB(journals_db, processed_journals)
      }
    }
  })
}

function toggleStreamerMode (e) {
  console.log('click')
  $('body').toggleClass('streamer-mode')
}

/*bring in jQuery (fuck the haters or am I trolling?)*/
window.addEventListener('DOMContentLoaded', () => {
  window.$ = window.jQuery = require('jquery')
  journal_path = os.homedir() +
    '\\Saved Games\\Frontier Developments\\Elite Dangerous'
  $('#DirectoryPathPreview').val(journal_path)
  star_types = readDB(star_db)
  processed_journals = readDB(journals_db)
  setTimeout(processJournals, 100)
  $('#EnableStreamerMode').on('click', toggleStreamerMode)
})

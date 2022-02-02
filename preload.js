// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

const {contextBridge, ipcRenderer} = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const moment = require('moment');
const LineByLineReader = require('line-by-line');
const db_dir = 'db/';
const config_db = path.join(__dirname, db_dir, 'config.json');
const stars_db = path.join(__dirname, db_dir, 'stars_db.json');
const stars_by_systems_db = path.join(__dirname, db_dir,
    'stars_by_systems_db.json');
const bodies_db = path.join(__dirname, db_dir, 'bodies_db.json');
const journals_db = path.join(__dirname, db_dir, 'journals_db.json');

const local_moment = moment();

let config = {
  journal_path: '',
  streamer_mode: false,
  auto_scan: false,
  window_size: {},
};

let file_count = 0;
let files_total = 0;
let processing_bodies = 0;
let processed_journals = [];
let detected_active_journal = false;
let auto_process = false;
let star_types = {};
let star_cache = [];
let body_cache = [];
let stars_by_systems = {};
let bodies_processed = {};

function readDB(db, expects) {
  // read & parse JSON object from file
  //return db
  if (expects === undefined) {
    expects = {};
  }
  try {
    const file_contents = fs.readFileSync(db, {encoding: 'utf-8', flag: 'r'});
    return JSON.parse(file_contents.toString());
  }
  catch (err) {
    console.log(err, db);
    return writeDB(db, expects);
  }
}

function writeDB(db, data) {
  // read JSON object from file
  // convert JSON object to string
  const to_json = JSON.stringify(data);
// write JSON string to a file
  try {
    fs.writeFileSync(db, to_json);

  }
  catch (err) {
    console.error(err);
  }
  return readDB(db);
}

contextBridge.exposeInMainWorld('ipcRenderer', {ipcRenderer});

function sortObjectByKeys(obj) {
  return Object.keys(obj).sort().reduce(function(result, key) {
    result[key] = obj[key];
    return result;
  }, {});
}

function chooseDirectory() {
  return ipcRenderer.sendSync('openDirectory', {});
}

function clearCacheThenIndex() {
  file_count = 0;
  files_total = 0;
  processing_bodies = 0;
  processed_journals = [];
  detected_active_journal = false;
  auto_process = false;
  star_types = {};
  star_cache = [];
  body_cache = [];
  stars_by_systems = {};
  bodies_processed = {};
  //clear local storages (json files)
  config = writeDB(config_db, {});
  star_types = writeDB(stars_db, {});
  stars_by_systems = writeDB(stars_by_systems_db, {});
  processed_journals = writeDB(journals_db, []);
  bodies_processed = writeDB(bodies_db, {});
  $('#JournalList').html('');
  //switch steps
  $('[data-step="2"]').removeClass('d-flex').slideUp();
  $('[data-step="1"]').slideUp().slideDown();

  setTimeout(init, 666);
}

function getStarIdFromPlanetsParents(parents) {
  if (typeof parents !== 'object') {
    return null;
  }
  let parent_id = null;

  parents.every(parent => {
    if (parent.hasOwnProperty('Star')) {
      parent_id = Number(parent['Star']);
      return false;
    }
    return true;
  });
  return parent_id;
}

function letterToNumber(letter) {
  return parseInt(letter, 36) - 9;
}

function catalogStarType(body_id, star_system, star_type) {

  if (!stars_by_systems.hasOwnProperty(star_system)) {

    stars_by_systems[star_system] = {};
  }

  stars_by_systems[star_system][body_id] = star_type;

  if (!star_types.hasOwnProperty(star_type)) {
    star_types[star_type] = {
      'Earthlike body':
          0,
      'Ammonia world':
          0,
      'Water world':
          0,
    };
  }
  star_cache = star_cache.filter((v) => {return v !== star_system + body_id;});
  checkStarProgress();
}

function catalogBody(elite_event) {
  /*Body Events*/
  let body_type = 0, star_system, star_type;

  if (elite_event.hasOwnProperty('PlanetClass')) {
    if (typeof bodies_processed[elite_event['BodyName']] !== 'undefined') {
      return false;
    }
    if (typeof star_system === 'undefined' ||
        typeof elite_event['StarSystem'] === 'undefined') {
      //convert body name to array
      star_system = detectStarSystemByBody(elite_event['BodyName']);
    }
    //set planet type only on the types we want
    switch (elite_event['PlanetClass']) {
      case 'Earthlike body' :
      case 'Ammonia world' :
      case 'Water world' :
        body_type = elite_event['PlanetClass'];
        break;
    }
    //move forward if we have a planet type set
    if (body_type) {
      if (star_system === null || !star_system.length) {
        if (typeof star_types['Unknown'] === 'undefined') {
          star_types['Unknown'] = {
            'Earthlike body':
                0,
            'Ammonia world':
                0,
            'Water world':
                0,
          };
        }
        star_types['Unknown'][body_type]++;
        return null;
      }
      //try to get a star id from the stars to systems references.
      let planets_star_id = getStarIdFromPlanetsParents(elite_event['Parents']);
      //If not null we found a match
      if (planets_star_id !== null) {
        //make sure star exists
        if (stars_by_systems.hasOwnProperty(star_system) &&
            typeof stars_by_systems[star_system][planets_star_id] !==
            'undefined') {
          //get the star type
          star_type = stars_by_systems[star_system][planets_star_id];
        }
        //star type not found, try to find using index
        else if (typeof stars_by_systems[star_system][0] !== 'undefined') {
          star_type = stars_by_systems[star_system][0];
        }
        else if (typeof stars_by_systems[star_system][1] !== 'undefined') {
          star_type = stars_by_systems[star_system][1];
        }
        //add count if we match a star to body
        if (star_type && star_types.hasOwnProperty(star_type)) {
          star_types[star_type][body_type]++;
        }
      }
      else {
        //barycenter
        //if no system name in codex
        //Setup new Barycenter system
        let barycenter_stars = [];
        let possible_star_types = Object.values(stars_by_systems[star_system]);
        let barycenter_stars_output = 'Barycenter (';
        let barycenter_code = elite_event['BodyName'].replace(
            star_system + ' ',
            '');
        barycenter_code = barycenter_code.replace(/[0-9]/g, '');
        barycenter_code = barycenter_code.replace(/[a-f]/g, '');
        barycenter_code = barycenter_code.replace(' ', '');
        barycenter_code = barycenter_code.split(' ')[0];

        $.each(barycenter_code.split(''), function(index, value) {
          const num_from_letter = letterToNumber(value) - 1;

          if (typeof possible_star_types[num_from_letter] !== 'undefined') {
            barycenter_stars.push(possible_star_types[num_from_letter]);
          }
          else {
            //console.log(star_system);
            //console.log(elite_event['BodyName'], stars_by_systems[star_system]);
          }

        });
        if (barycenter_stars.length > 1) {
          barycenter_stars_output += barycenter_stars.toString() + ')';
        }
        else {
          barycenter_stars_output = barycenter_stars[0];
        }

        if (!star_types.hasOwnProperty(barycenter_stars_output)) {
          star_types[barycenter_stars_output] = {
            'Earthlike body':
                0,
            'Ammonia world':
                0,
            'Water world':
                0,
          };
        }
        star_types[barycenter_stars_output][body_type]++;
      }

    }
  }
  bodies_processed[elite_event['BodyName']] = elite_event['BodyName'];
  updateScanStatusDisplay('Processed: ' + body_type + ' / ' + bodies_processed[elite_event['BodyName']]);

}

function updateScanStatusDisplay(msg) {
  $('#ScanProgress').text(msg);
}

function detectStarSystemByBody(body_name) {
  let detected_system_name = null;
  Object.entries(stars_by_systems).forEach(system => {
    let [system_name] = system;
    if (body_name.match(system_name)) {
      if (system_name.length) {
        detected_system_name = system_name;
        return detected_system_name;
      }

    }
  });

  return detected_system_name;
}

function checkStarProgress() {
  //console.log(file_count, files_total, star_cache.length, processing_bodies)
  if (file_count >= files_total && !star_cache.length && !processing_bodies) {
    writeDB(stars_by_systems_db, stars_by_systems);
    processBodyCache();
  }
  if (auto_process) {
    writeDB(stars_by_systems_db, stars_by_systems);
    processBodyCache();
  }
}

function processBodyCache() {
  //console.log('Processing bodies')
  processing_bodies = 1;
  if (!body_cache.length) {
    setTimeout(outputResults, 150);
    return true;
  }
  let current_body;
  while (current_body = body_cache.pop()) {
    catalogBody(current_body);
  }

  if (!body_cache.length) {
    console.log('done');
    setTimeout(outputResults, 150);
    processing_bodies = 0;
    return true;
  }

  return true;
}

function processJournalEvent(elite_event) {
  let star_type;
  let star_system;

  if (elite_event &&
      elite_event['event'] === 'Shutdown') {
    return true;
  }
  //check for the type of scan we need
  if (elite_event &&
      ((elite_event['event'] !== 'Scan') ||
          (typeof elite_event['ScanType'] !== 'undefined' &&
              elite_event['ScanType'] === 'NavBeaconDetail'))) {
    return false;
  }

  star_system = elite_event['StarSystem'];

  /*Star Entries*/
  //checks to make sure scan is a star
  if (elite_event.hasOwnProperty('StarType') &&
      elite_event.hasOwnProperty('Luminosity')) {
    let body_id = parseInt(elite_event['BodyID']);

    let subclass = elite_event.hasOwnProperty('Subclass') ? elite_event['Subclass'] : '';
    star_type = elite_event['StarType'] + subclass + ' ' + elite_event['Luminosity'];
    if (typeof star_system === 'undefined') {
      star_system = elite_event['BodyName'];
      if (body_id) {
        star_system = elite_event['BodyName'].split(' ');
        star_system.pop();
        star_system = star_system.join(' ');
      }
    }

    star_cache.push(star_system + body_id);

    catalogStarType(body_id, star_system, star_type);
    return false;
  }
  /*Bodies*/
  else {
    if (elite_event.hasOwnProperty('PlanetClass') &&
        (elite_event['PlanetClass'] === 'Earthlike body' ||
            elite_event['PlanetClass'] === 'Ammonia world' ||
            elite_event['PlanetClass'] === 'Water world')) {
      cacheBody(elite_event);
      return false;
    }
  }
  return false;
}

function cacheBody(elite_event) {
  body_cache.push(elite_event);
  if (auto_process) {
    checkStarProgress();
  }
}

function readJournalLineByLine(file) {
  let logPath = config.journal_path + '\\' + file;
  let complete_file = false;
  let lr = new LineByLineReader(logPath, {
    encoding: 'utf8',
    skipEmptyLines: true,
  });

  lr.on('error', function(err) {
    // 'err' contains error object
    console.log(err);
  });
  lr.on('line', function(line) {
    //Parse JSON from Journal file
    let elite_event;
    if (!elite_event) {
      try {
        complete_file = processJournalEvent(JSON.parse(line));
      }
      catch (e) {
        console.error(e);
        elite_event = null;
        return false;
      }
    }
  });
  lr.on('end', function() {
    file_count++;
// All lines are read, file is closed now.
    let journal_item = $('' +
        '<li class="list-group-item bg-transparent text-light">' +
        '<i class="fas fa-atlas"></i><span class="file-name ms-3"></span><span class="ms-4 text-success"><i class="fas fa-check"></i></span>' +
        '</li>');
    journal_item.find('span.file-name').text(file);
    $('#JournalList').append(journal_item);
    const listHistory = document.getElementById('JournalList');
    listHistory.scrollTop = listHistory.scrollHeight;

    const mtime = moment(fs.statSync(config.journal_path + '/' + file).mtime);
    checkStarProgress();
    if (!complete_file && local_moment.diff(mtime, 'days') === 0) {
      detected_active_journal = config.journal_path + '/' + file;
      return true;
    }

    processed_journals.push(file);

    return true;
  });
}

function compare(idx) {
  return function(a, b) {
    let A = tableCell(a, idx), B = tableCell(b, idx);
    return $.isNumeric(A) && $.isNumeric(B) ?
        A - B : A.toString().localeCompare(B);
  };
}

function tableCell(tr, index) {
  return $(tr).children('td').eq(index).text();
}

function setIcon(element, inverse) {

  var iconSpan = $(element).find('[data-fa-i2svg]');

  if (inverse == false) {
    $(iconSpan).
        removeClass('fa-sort').
        removeClass('fa-sort-down').
        addClass('fa-sort-up');

  }
  else {
    $(iconSpan).
        removeClass('fa-sort').
        removeClass('fa-sort-up').
        addClass('fa-sort-down');
  }
  $(element).
      siblings().
      find('[data-fa-i2svg]').
      removeClass('fa-sort-down').
      removeClass('fa-sort-up').
      addClass('fa-sort');
}

function outputResults() {
  //sort stars
  star_types = sortObjectByKeys(star_types);
  //update display
  updateBodyCountDisplay();
  //switch steps
  $('[data-step="1"]').removeClass('d-flex').slideUp();
  $('[data-step="2"]').slideUp().slideDown();

  //add events for search filtering
  $('#StarSearch').on('keyup', function() {
    const value = $(this).val().toLowerCase();
    $('#ResultsContainer tr').filter(function() {
      $(this).
          toggle(
              $(this).find('td').first().text().toLowerCase().indexOf(value) >
              -1);
    });
  });
  //store values to db
  writeDB(stars_db, star_types);
  writeDB(journals_db, processed_journals);
  writeDB(bodies_db, bodies_processed);

  //checks if we have detected a active journal
  if (detected_active_journal) {
    //Show enable watch button and setup click event
    $('#EnableWatch').show().on('click', (e) => {
      //set auto_process flag
      config = readDB(config_db)
      auto_process = config.auto_scan = !config.auto_scan;
      writeDB(config_db, config);
      //update button styles
      if (config.auto_scan) {
        $('#EnableWatch').
            removeClass('btn-outline-success').
            addClass('btn-outline-danger').
            html(
                '<i class="fas fa-book-reader me-2"></i>Disable Auto Watch <i class="fas fa-check"></i>');
        //kick off watch process
        watchAndProcess(detected_active_journal);
        return config.auto_scan;
      }
      $('#EnableWatch').
          removeClass('btn-outline-danger').
          addClass('btn-outline-success').
          html(
              '<i class="fas fa-book-reader me-2"></i>Enable Auto Watch');
      //kick off watch process
      stopWatchAndProcess(detected_active_journal);
    });
    if (config.auto_scan) {
      $('#EnableWatch').trigger('click');
    }
  }
}

function calculateBodyTotals() {
  let newELWCount = 0;
  let newAWCount = 0;
  let newWWCount = 0;
  Object.values(star_types).forEach((value) => {
    newELWCount = newELWCount + parseInt(value['Earthlike body']);
    newAWCount = newAWCount + parseInt(value['Ammonia world']);
    newWWCount = newWWCount + parseInt(value['Water world']);
  });
  $('.planet-total.earth .total').
      text(newELWCount);
  $('.planet-total.ammonia .total').
      text(newAWCount);
  $('.planet-total.water .total').
      text(newWWCount);
}

function updateBodyCountDisplay() {
  //clear out any current rows
  $('#ResultsContainer').html('');
  //build/rebuild table and counts
  calculateBodyTotals();
  Object.entries(star_types).forEach(entry => {
    let [star_type, planets] = entry;
    //checks for empty stars
    if (!planets['Earthlike body'] && !planets['Ammonia world'] &&
        !planets['Water world']) {
      return false;
    }
    //remames neutrons
    if (star_type === 'N0 VII') {
      star_type = 'Neutron';
    }
    //builds html row
    let new_row = $(`<tr class="star-data-row" data-star-type="${star_type}">`);
    //adds first column for star type
    new_row.append(`<td>${star_type}</td>`);
    //builds columns for each body type
    Object.entries(planets).forEach(planet => {
      let [planet_type, count] = planet;
      //add column to html
      new_row.append(
          `<td data-planet-type="${planet_type}" data-count="${count}">${count}</td>`);
    });
    //append the whole row
    $('#ResultsContainer').append(new_row);
  });
  //click event for sorting the table, ripped from stack overflow lol
  $('th.sortable').click(function(e) {
    const table = $(this).parents('table').eq(0);
    let ths = table.find('tr:gt(0)').toArray().sort(compare($(this).index()));
    this.asc = !this.asc;
    if (!this.asc) {
      ths = ths.reverse();
    }
    for (var i = 0; i < ths.length; i++) {
      table.append(ths[i]);
    }
    setIcon(e.target, this.asc);
  });

}

function getTotalLogsCount(files) {
  //set initial total to 0
  let total = 0;
  //loop through all files
  files.forEach(file => {
    //check if file had already been processed and is right extension
    if (!processed_journals.includes(file) && path.extname(file) === '.log') {
      //add to count if passes check
      total++;
    }
  });
  //returns the new total
  return total;
}

function processJournals() {
  //Read through journal directory
  fs.readdir(config.journal_path, (err, files) => {
    if (err) {
      //error happened blah blah
      console.log(err);
      return false;
    }
    //store the total files we detect,
    //this is to compare with current files to detect if complete
    files_total = getTotalLogsCount(files);
    //only process if there are files
    if (files_total) {
      //loop through each file
      files.forEach(file => {
        //checks if this journal file has been processed and is the right type
        // of file
        if (!processed_journals.includes(file) && path.extname(file) ===
            '.log') {
          //calls function to read file line by line
          //each line is a game event in JSON format
          readJournalLineByLine(file);
        }
      });
      //return when done, wont fire if all journals are cached
      return true;
    }

    //if we made it this far we are just using cached data
    if (Object.entries(star_types).length) {
      //calls function to output all data to screen
      //setTimeout just incase
      setTimeout(outputResults, 150);
    }
  });
}

function watchAndProcess(journal_file) {

  detected_active_journal = journal_file;
// Obtain the initial size of the log file before we begin watching it.
  let fileSize = fs.statSync(journal_file).size;
  fs.watchFile(journal_file, function(current, previous) {
    // Check if file modified time is less than last time.
    // If so, nothing changed so don't bother parsing.
    if (current.mtime <= previous.mtime) { return; }

    // We're only going to read the portion of the file that
    // we have not read so far. Obtain new file size.
    const newFileSize = fs.statSync(journal_file).size;
    // Calculate size difference.
    let sizeDiff = newFileSize - fileSize;
    // If less than zero then Hearthstone truncated its log file
    // since we last read it in order to save space.
    // Set fileSize to zero and set the size difference to the current
    // size of the file.
    if (sizeDiff < 0) {
      fileSize = 0;
      sizeDiff = newFileSize;
    }
    // Create a buffer to hold only the data we intend to read.
    const buffer = Buffer.alloc(sizeDiff);
    // Obtain reference to the file's descriptor.
    const fileDescriptor = fs.openSync(journal_file, 'r');
    // Synchronously read from the file starting from where we read
    // to last time and store data in our buffer.
    fs.readSync(fileDescriptor, buffer, 0, sizeDiff, fileSize);
    fs.closeSync(fileDescriptor); // close the file
    // Set old file size to the new size for next read.
    fileSize = newFileSize;

    // Parse the line(s) in the buffer.
    //console.log(buffer.toString())
    parseBuffer(buffer);
  });

}

function stopWatchAndProcess() {
  fs.unwatchFile(detected_active_journal);
}

function parseBuffer(buffer) {
  // Iterate over each line in the buffer.
  buffer.toString().split(os.EOL).forEach(function(line) {
    // Check if line has anything to process
    if (line.length) {
      //convert to json, not sure why I have to parse twice but it works
      let lineJSON = JSON.parse(JSON.parse(JSON.stringify(line)));
      /*
        processJournalEvent returns true if
        it detects Event: Shutdown from game
        so we know this journal file is complete
        Returns false for any other entry
      */
      if (processJournalEvent(lineJSON)) {
        console.log('stop watching, and mark as processed');
        //these next actions end the file watch process and cache the journal
        // to localdb
        stopWatchAndProcess(detected_active_journal);
        processed_journals.push(detected_active_journal);
        writeDB(journals_db, processed_journals);
      }
      else {
        //Still watching, mainly outputting to console for debugging here
        console.log('Processing Event', lineJSON, stars_by_systems, body_cache);
      }
    }
  });
}

/*Event listener for button that toggles streamer mode*/
function toggleStreamerMode(e) {
  if (typeof e !== 'undefined' && typeof e.preventDefault === 'function') {
    e.preventDefault();
    config = readDB(config_db)
    config.streamer_mode = !config.streamer_mode;
    writeDB(config_db, config);
  }
  $('body').toggleClass('streamer-mode');
  //update button styles
  if (config.streamer_mode) {

    $('#EnableStreamerMode').
        removeClass('btn-outline-light').
        addClass('btn-outline-warning').
        html('<i class="fas fa-video me-2"></i> Disable Streamer Mode <i class="fas fa-check"></i>');
    return config.streamer_mode;
  }
  $('#EnableStreamerMode').
      removeClass('btn-outline-warning').
      addClass('btn-outline-light').
      html('<i class="fas fa-video me-2"></i> Enable Streamer Mode');
}

function init() {
  //read config from local db
  config = readDB(config_db);
  console.log(config);
  //set streamer mode property if first time
  if (typeof config.streamer_mode === 'undefined') {
    config.streamer_mode = 0;
    writeDB(config_db, config);
  }
  if (config.streamer_mode) {
    toggleStreamerMode();
  }
  //set journal location property if first time
  if (typeof config.journal_path === 'undefined' || config.journal_path ===
      '') {
    config.journal_path = path.join(os.homedir(),
        '/Saved Games/Frontier Developments/Elite Dangerous');
    writeDB(config_db, config);
  }
  //Set the directory path preview input to journal path
  $('#DirectoryPathPreview').val(config.journal_path);

  //read in stars and bodies data storage
  star_types = readDB(stars_db);
  stars_by_systems = readDB(stars_by_systems_db);
  processed_journals = readDB(journals_db, []);
  bodies_processed = readDB(bodies_db);

  //start the process to loop through all journals
  setTimeout(processJournals, 100);

  /*UI events*/
  $('#EnableStreamerMode').on('click', (e) => {toggleStreamerMode(e);});

  $('#TriggerClearCache').on('click', clearCacheThenIndex);
}

window.addEventListener('DOMContentLoaded', () => {
  //omg jQuery! how old are you?
  window.$ = window.jQuery = require('jquery');

  init();

});

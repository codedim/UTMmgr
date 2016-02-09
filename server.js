const SERVER_PORT = 82;
const MAIN_PATH = require('path').dirname(__filename).replace(/\\/g, '/');
const DOCS_PATH = MAIN_PATH; 

const STATUS_DATFILE =    'status.txt';        // single-line status html data
const RESPONSE_DATFILE =  'response.txt';      // utm (after-request) response data
const OPTOUT_DATFILE =    'optout.txt';        // last-known line in 'opt/out' dir
const ORG_PAGEFILE =      'contragents.html';
const SET_PAGEFILE =      'settings.html';

const ORG_DIR = 'org/';   // organization DB
const XML_DIR = 'xml/';   // xml templates

const OPTOUTLINK = 'http://localhost:8080/opt/out';

var isInetStateOk = false;   // Internet state flag
var isUtmStateOk =  false;   // UTM state flag
var newUtmDocMsg =  '';      // status message about new UTM doc(s)

var http = require('http');
var static = require('node-static');
var url = require('url');
var rdFile = require('fs');
var wrFile = require('fs');
var file = new static.Server(DOCS_PATH, { cache: 0 });


////////////////////////////  MAIN SERVER ROUTINES  //////////////////////////////

// request listener
function accept(req, res) {

	// parse the requested url string
	var pathName = url.parse(req.url, true).pathname;
	var queryData = url.parse(req.url, true).query;
//	console.log(req.url); // test

	// reset status info if user opens a new page 
	// (a page, without any get-parameters)
	if ( (pathName == '/' || /\.html/i.test(pathName)) && 
		isEmptyObject(queryData) ) 
			clearStatusInfo();

	// process page get-parameters
	switch (pathName) {
	case '/settings.html':
		if (queryData.inn && queryData.fsrarid) {
			setNamedInputValue(SET_PAGEFILE, 'inn', queryData.inn);
			setNamedInputValue(SET_PAGEFILE, 'fsrarid', queryData.fsrarid);
			updateMainOrg(queryData.fsrarid, queryData.inn);
		}
		break;
	case '/contragents.html':
		if (queryData.submited == 'delete' && queryData.checked) {
			deleteOrg(queryData.checked);
		} else if (queryData.submited == 'change' && queryData.checked) {
			req.url = '/vieworg.html?submited=change&checked=' + queryData.checked;
		} else if (queryData.submited == 'add') {
			req.url = '/addorg.html?submited=add';
		}
		break;
	case '/addorg.html':
		if (queryData.inn) {
			if (addOrgIntoPage(queryData.inn))
				queryOrgByINN(queryData.inn);
			req.url = '/contragents.html';
			// delay to wait for UTM respnose 
			setTimeout(function() {  file.serve(req, res);  }, 2000);
			return;
		}
		break;
	}

	file.serve(req, res);
}

// start server
if (!module.parent) {
	http.createServer(accept).listen(SERVER_PORT);
	console.log('Webserver running on "localhost:' + SERVER_PORT + 
		'" with root directory "' + DOCS_PATH + '"\n');
} else {
	exports.accept = accept;
}

// start ivent handler timer
setInterval(function() { 
	// get internet and utm status
	getUtmStatus();

	// update status bar, after 1 seccond
	setTimeout(function() {
		setUtmStatus(newUtmDocMsg);
	}, 1000);
}, 2000);


//////////////////////////////  SERVICE ROUTINES  ////////////////////////////////

// determines that 'obj' object is empty
function isEmptyObject(obj) {
	for (var i in obj) return false;
	return true;
}

// reads from file
function readFile(fname) {
	return rdFile.readFileSync(DOCS_PATH + '/' + fname, 'utf8');
}

// writes data to file with some checkouts,
// note: the 'caller' arg is for debug perposes
function writeFile(fname, data, caller) {
	const WRITE_FLAG = DOCS_PATH + '/wrfile.flag';
	var fName = DOCS_PATH + '/' + fname;
	
	if (!isFileExists(WRITE_FLAG)) {
		writeFileSafely(fName, data, caller, WRITE_FLAG);
		return;
	}

	// while WRITE_FLAG exists - writing file operations 
	// are not allowed. so, we have to wait for some time
	// while previous writing operation is completed
	var timerId = setTimeout(function() {
		// checkout the WRITE_FLAG file exists
		if (!isFileExists(WRITE_FLAG)) {
			// ok, we can write a file 
			writeFileSafely(fName, data, caller, WRITE_FLAG);
		} else {
			// this is ubnormal situation actually
			throw 'Error: WRITE_FLAG is set up!';
		}
	}, 50);
}

function writeFileSafely(fname, data, caller, w_flag) {
	// set w_flag up
	wrFile.writeFileSync(w_flag, caller);
	// write the file data to a temp file
	wrFile.writeFileSync(fname + '.tmp', data);
	// delete original file if it exists
	if (isFileExists(fname)) wrFile.unlinkSync(fname);
	// unset w_flag here - to make some delay within
	// main file write operations
	wrFile.unlinkSync(w_flag);
	// rename temp file with the original failname
	wrFile.renameSync(fname + '.tmp', fname);
}

// checks that RegExp has matched and logs if not 
function testRegExp(rexp, text, caller) {
	if ( !rexp.test(text) ) {
		console.log('Error: Unmatched RegExp: ' + rexp + ' in ' + caller);	
		return false;
	}
	return true;
}

// tests the specified file exists
function isFileExists(fpath) {
	try {
		rdFile.accessSync(fpath, rdFile.F_OK);
	} catch(e) {
		return false;
	}
	return true;
}


/////////////////////////////  FRONT-END ROUTINES  ///////////////////////////////

// sets VALUE of FORM INPUT with NAME in html FILE
// note: single line <input> teg is required
function setNamedInputValue(fname, iname, ivalue) {
	// read file to temp buffer
	var text = readFile(fname);
	// replace input value
	var rexp = new RegExp('<input (.*?)name="' + iname + '" (.*?)value=".*?"', 'mi');
	text = text.replace(rexp, '<input $1name="' + iname + '" $2value="' + ivalue + '"');
	// seve to file
	writeFile(fname, text, 'setNamedInputValue');
	// update status 
	setRequestStatus('Сохранено');
}

//	sets the 'fvalue' as a value of TABLE field whose <TD> teg class is
//  'fclass', as the 'fline' string is expected all <TR>...</TR> content.
function setTabLineField(fline, fclass, fvalue) {
	var rexp = new RegExp('<td class="' + fclass + '">.*?<', 'mi');
	return fline.replace(rexp, '<td class="' + fclass + '">' + fvalue + '<');
}

//	sets the 'ivalue' as a VALUE of form INPUT teg. returns changed 'fline'.
function setTabInputValue(fline, ivalue) {
	return fline.replace(/<input (.*?) value=".*?">/mi, '<input $1 value="' + ivalue + '">');
}

//  updates owner's FSRARID and INN into ORG_PAGEFILE table
//  and makes QueryPartner request to EGAIS
function updateMainOrg(fsrarid, inn) {
	var text = readFile(ORG_PAGEFILE);

	// get all content '<tr id="main">...</tr>' teg
	var rexp = new RegExp('^<tr id="main.*\r\n.*\r\n.*tr>', 'mi');
	if (!testRegExp(rexp, text, 'updateMainOrg')) 
		return;
	var tabLine = text.match(rexp)[0];

	// replace values
	tabLine = setTabLineField(tabLine, 'id', fsrarid);
	tabLine = setTabLineField(tabLine, 'inn', inn);
	tabLine = setTabInputValue(tabLine, inn);
	// replace table line
	text = text.replace(rexp, tabLine);

	// save data to ORG_PAGEFILE 
	writeFile(ORG_PAGEFILE, text, 'updateMainOrg');

	// delete old 'org/inn.xml' is exists
	if (isFileExists(DOCS_PATH + '/' + ORG_DIR + inn + '.xml')) {
		wrFile.unlinkSync(DOCS_PATH + '/' + ORG_DIR + inn + '.xml');
	}
	
	// request for org EGAIS data
	queryOrgByINN(inn);
	setRequestStatus('Запрос данных основной организации');
}

//  adds new organization's table line (<tr> teg) into ORG_PAGEFILE
function addOrgIntoPage(inn) {
	var text = readFile(ORG_PAGEFILE);
	var rexp = new RegExp('^<tr.*inn">' + inn + '.*\r\n.*\r\n.*tr>', 'mi');
	if (rexp.test(text)) {
		console.log('Error: The organization with INN "' + inn + 
			'" already exists!');
		setRequestStatus('Ошибка запроса');		
		return false;
	}
	
	// the 'inn' was not found - it's ok, write new line
	text = text.replace(/<\/table>/im, 
		'<tr class="o"><td class="id">n/a</td><td class="inn">' + inn + '</td>\r\n' + 
		' <td class="kpp">n/a</td><td class="name">n/a</td><td class="addr">n/a</td>\r\n' + 
		' <td><input type="radio" name="checked" value="' + inn + '"></td></tr>\r\n</table>');
	
	writeFile(ORG_PAGEFILE, text, 'addOrgIntoPage');
	return true;
}

//  deletes org with 'inn' from ORG_PAGEFILE and from 'org\' dir
function deleteOrg(inn) {
	var text = readFile(ORG_PAGEFILE);
	var rexp = new RegExp('^<tr.*inn">' + inn + '.*\r\n.*\r\n.*tr>\r\n', 'mig');
	if (!testRegExp(rexp, text)) 
		return;
	text = text.replace(rexp, '');
	writeFile(ORG_PAGEFILE, text, 'deleteOrg');

	// delete 'org/inn.xml' is exists
	if (isFileExists(DOCS_PATH +'/' + ORG_DIR + inn + '.xml')) {
		wrFile.unlinkSync(DOCS_PATH +'/' + ORG_DIR + inn + '.xml');
	}
	setRequestStatus('Удалено');
}

//  fills the corresponding table line (its <TD> tegs) in ORG_PAGEFILE
//  accordingly to data of 'org/inn.xml' files 
function rebuildOrgPage(inn) {
	var xmlPath = ORG_DIR + inn + '.xml';
	var xmlData = readFile(xmlPath);

	// get all content of corresponding <tr> teg
	var orgData = readFile(ORG_PAGEFILE);
	var tabLineRegExp = new RegExp('^<tr.*inn">' + inn + 
		'.*\r\n.*\r\n.*tr>.*\r\n', 'mi');
	var tabLine = orgData.match(tabLineRegExp);
	if (tabLine == null) {
		console.log('Error: Unmatched RegExp: ' + tabLineRegExp);	
		return;
	}
	tabLine = tabLine[0];
	tabLines = '';

	// the organization (INN) may have multiple clients (KPPs)
	var rexp = /<rc\:Client/ig;
	while (rexp.exec(xmlData)) {
		// fsrar_id
		var value = getValueFromXml(xmlPath, 'oref:ClientRegId', rexp.lastIndex);
		if (value) tabLine = setTabLineField(tabLine, 'id', value);
		// inn
		tabLine = setTabInputValue(tabLine, inn);	
		// kpp 
		if (inn.length == 12) {
			// there is no 'kpp' for individual 
		} else {
			value = getValueFromXml(xmlPath, 'oref:KPP', rexp.lastIndex);
			if (value) tabLine = setTabLineField(tabLine, 'kpp', value);
		}
		// name 
		value = getValueFromXml(xmlPath, 'oref:ShortName', rexp.lastIndex);
		if (value) tabLine = setTabLineField(tabLine, 'name', value);
		// address 
		value = getValueFromXml(xmlPath, 'oref:description', rexp.lastIndex);
		if (value) tabLine = setTabLineField(tabLine, 'addr', value);

		tabLines += tabLine;
		tabLine = 
	 '<tr class="o"><td class="id">n/a</td><td class="inn">' + inn + '</td>\r\n' + 
	 ' <td class="kpp">n/a</td><td class="name">n/a</td><td class="addr">n/a</td>\r\n' + 
	 ' <td><input type="radio" name="checked" value="' + inn + '"></td></tr>\r\n';
	}

	// rewrite tabLine(s) and save 
	orgData = orgData.replace(tabLineRegExp, tabLines);
	writeFile(ORG_PAGEFILE, orgData, 'rebuildOrgPage');

	setRequestStatus('Обновлено');
}

//	returns value of 'valName' tag from 'xmlFile' begining with 'fromPos' position
function getValueFromXml(xmlFile, valName, fromPos) {
	// check out that xml file exists
	if (!isFileExists(xmlFile))	{ 
		console.log('Error: "' + xmlFile + '" not found.');
		return '';  // no xmlfile - nothing to do
	}
	xmlData = readFile(xmlFile);

	rexp = new RegExp(valName + '>(.*?)<', 'ig');
	rexp.lastIndex = fromPos;
	var value = rexp.exec(xmlData);
	if (value == null) {
		console.log('Error: Unmatched RegExp: ' + rexp + ' in file ' 
			+ xmlFile + ' from Pos=' + fromPos);	
		return '<span class="err">n/a</span>';
	} else {
		return value[0].replace(rexp, '$1');
	}
}


//////////////////////////////  UTM STATUS ROUTINES  /////////////////////////////

//	clears the request part of single-line status file, when the user opens a new page
function clearStatusInfo() {
	var text = readFile(STATUS_DATFILE);

	// clear the user request status info
	text = text.replace(/<div id="reqstatus">.*<\/div><div id="utmstatus">/i, 
		'<div id="reqstatus"></div><div id="utmstatus">');

	// clear the new utm document status info
	newUtmDocMsg = '';
	text = text.replace(/<div id="utmstatus">.*id="TT/i, 
		'<div id="utmstatus"> | <span id="TT');

	// rewrite status file, after one second timeout
	setTimeout(function() { 
		writeFile(STATUS_DATFILE, text, 'clearStatusInfo'); 
	}, 1000);
}

//	sets the user request part of status line, when the user has maked a get-request
function setRequestStatus(str) {
	var text = readFile(STATUS_DATFILE);
	text = text.replace(/<div id="reqstatus">.*<\/div><div id="utmstatus">/i, 
		'<div id="reqstatus">' + str + '</div><div id="utmstatus">');
	writeFile(STATUS_DATFILE, text, 'setRequestStatus');
}

//	tests Internet connection and UTM status, sets the global flags (isUtmStateOk, 
//  isInetStateOk) up and fill in the global UTM state string (newUtmDocMsg).
//
//  searches new docs in UTM 'opt/out' and calls handle function for each one. 
//  rewrites last-known doc data file OPTOUT_DATFILE.
function getUtmStatus() {

	// to test Internet status we will test availability of 
	// some google resource, such as small icon or png file
	const testInetRes = 'http://www.google.com/favicon.ico';  // ~7KB
	var testInetReq = require('request');
	testInetReq.get(testInetRes, function(err, res, body) {
		(err) ? isInetStateOk = false : isInetStateOk = true;
	});

	// to test UTM status we will check its outgoing docs page
	var newDocs = 0;
	var testUtmReq = require('request');
	testUtmReq.get(OPTOUTLINK, function(err, res, body) {
		(err) ? isUtmStateOk = false : isUtmStateOk = true;
		if (!isUtmStateOk) return;

		// if UTM state is OK, search for new docs..
		var docs = body.match(/<url.*url>/ig);
		// the last handled document ID must be in OPTOUT_DATFILE
		var text = readFile(OPTOUT_DATFILE);
		var lastDoc = text.match(/<url replyId=".{36}">/i)[0];
		if (lastDoc) {
			// OPTOUT_DATFILE consists the last handled doc, 
			// now we have to search it in '/opt/out' dir
			var docSearched = false;
			for (doc in docs) {
				if (docSearched) { 
					++newDocs;
					handleUtmDoc(docs[doc]);
					writeFile(OPTOUT_DATFILE, docs[doc], 'getUtmStatus');
				}
				if (docs[doc].search(lastDoc) != -1) docSearched = true;
			}

			// what about if the doc has been deleted?
			if (!docSearched) {
				console.log('Error: Document ID: ' + 
					lastDoc.replace(/<url replyId="(.*?)">/i, '$1') + 
					'\n  was not found in "' + OPTOUTLINK + '",' + 
					'\n  perhaps it has been deleted from UTM data base.');
			}
		} else {
			// OPTOUT_DATFILE is empty, so all docs in '/opt/out' dir have the new status
			for (doc in docs) { 
				++newDocs;
				handleUtmDoc(docs[doc]);
				writeFile(OPTOUT_DATFILE, docs[doc], 'getUtmStatus');
			}
		}

		// set new doc status message up
		if (newDocs) {
			newUtmDocMsg = '<a href="' + OPTOUTLINK + '" target="_blank">';
			if (newDocs == 1)
				newUtmDocMsg += 'один</a> новый документ';
			else if (newDocs <= 4)
				newUtmDocMsg += newDocs + '</a> новых документа';
			else 
				newUtmDocMsg += newDocs + '</a> новых документов';
		} else {
			// this routine does not clear the global 'new doc(s)' status message.
			// the clearStatusInfo() function does that...
		}
	});
}

//	sets the utm part of single-line status file, on timer has ticked
function setUtmStatus(str) {
	var text = readFile(STATUS_DATFILE);
	
	// <span class=""> teg for UTM status
	var classUtm = (isUtmStateOk) ? 'ok' : 'err';
	text = text.replace(/id="TT" class=".{2,3}">UTM<\/span>/i, 
		'id="TT" class="' + classUtm + '">UTM</span>');
	
	// <span class=""> teg for Internet status
	var classInet = (isInetStateOk) ? 'ok' : 'err';
	text = text.replace(/<span class=".{2,3}">Internet<\/span>/i, 
		'<span class="' + classInet + '">Internet</span>');
	
	// 'str' argument info
	text = text.replace(/utmstatus">.*?id=/i, 
		'utmstatus">' + str + ' | <span id=', 'i');
	
	writeFile(STATUS_DATFILE, text, 'setUtmStatus');
}

//	does required operations when new UTM document appears	
function handleUtmDocCallback(err, res, body) {
	if (err) { 
		console.log('Request error: ' + err.code + 
			' from ' +  err.address + ':' + err.port);
		return;
	}

	// get doc category from redirected url from the request
	var docUrl = res.request.uri.href;
	var docCategory = docUrl.replace(/^.*opt\/out\//i, '').replace(/\/.*/i, '');
	console.log('processing new UTM document "' + docUrl + '"');

	// process last doc by categories
	switch (docCategory) {

	case 'ReplyPartner':
		// if we have made the 'QueryPartner' request - its 'inn' value 
		// should be saved as 'xml/inn.query' file. so lets get it out...
		
		// lets try to get the 'inn' value from current doc
		var docInn;
		if (/<oref:INN>/i.test(body)) {
			docInn = body.replace(/.*<oref:INN>(.*?)<\/.*/mi, '$1');
		}
		if (docInn) {
			console.log('  new organization with INN ' + docInn);
			// save it to data xmlfile
			writeFile(ORG_DIR + docInn + '.xml', body, 'handleUtmDocCallback');
			// rebuild the correspondig webpage
			rebuildOrgPage(docInn);
		} else {
			// EGAIS can return an empty xmlfile - there is no data for this 'inn' 
			console.log('  no organization with specified INN found');
			setRequestStatus('Организация не найдена');
		}

		break;	

	default:
		console.log('Error: Unknown category "' + docCategory + 
			'" in "' + docUrl + '"');
		return;
	}
}

function handleUtmDoc(newDoc) {
	// get url of doc
	var docUrl = newDoc.replace(/^.*http:/i, 'http:');
	docUrl = docUrl.replace(/<\/url>/i, '');

	// make request to retrieve doc body
	require('request').get(docUrl, handleUtmDocCallback);
}


////////////////////////  UTM INTERCONNECTION ROUTINES  //////////////////////////

//  queries org with 'inn' from UTM service
function queryOrgByINN(inn) {
	const XMLFILE = XML_DIR + 'client.xml'; // xmlfile template
	const QUERYFILE = ORG_DIR + inn + '.query'; // unhandled query file 
	const QUERYURL = 'http://localhost:8080/opt/in/QueryPartner';

	// determining the owner FSRAR_ID value from SET_PAGEFILE
	var text = readFile(SET_PAGEFILE);
	var rexp = new RegExp('name=\"fsrarid\" value=\"[0-9]*', 'i');
	if (!testRegExp(rexp, text, 'queryOrgByINN'))
		return;
	var ownerid = text.match(rexp)[0].replace(/name="fsrarid" value="/i, '');
	
	// building the xml-file
	text = readFile(XMLFILE);
	text = text.replace(/<ns:FSRAR_ID>/im, '<ns:FSRAR_ID>' + ownerid);
	text = text.replace(/<qp:Value>/mi, '<qp:Value>' + inn);
	// saving the query xml-file
	writeFile(XMLFILE + '.tmp', text, 'queryOrgByINN');
	// seving the unhandled 'inn.query' file
//	writeFile(QUERYFILE, '', 'queryOrgByINN');

	postFileRequest(QUERYURL, 'xml_file', XMLFILE + '.tmp');
}

//  tests response from UTM, returns 'true' if it's valid.
function testUtmResponse(utmres) {
	// if it's OK the UTM webserver must return the xml-file 
	// that consists the <url> and <sign> tegs with known 
	// length of those values (url=36 and sign=128)
	var result = /^<\?xml.*<url>.*<sign>/i.test(utmres);

	// have to make a Note into request status
	var resultStr = 'Запрос принят';
	if (!result) {
		resultStr = 'Ошибка запроса (<a href="' + RESPONSE_DATFILE + 
			'" target="_blank">подробнее</a>)';
		writeFile(RESPONSE_DATFILE, utmres, 'testUtmResponse');
	}

	setRequestStatus(resultStr);
	return result;
}

//  sends the 'fname' to 'rhost' as POST form-data request.
//  note: it should works like a 'curl -F "vname=@fname" rhost'.
function postFileRequestCallback(err, res, body) {
	if (err) console.log('Request error: ' + err.code + 
		' from ' +  err.address + ':' + err.port);

	if (body) testUtmResponse(body);
}

function postFileRequest(rhost, vname, fname) {
	// require 'request' and 'form-data' modules
	var request = require('request');
	var FormData = require('form-data');

	// builds form-data
	var form = new FormData();
	form.append(vname, rdFile.createReadStream(fname));

	// adds required request headers
	form.getLength(function(err, length){
		if (err) return postFileRequestCallback(err);

		var rq = request.post(rhost, postFileRequestCallback);
		rq._form = form;     
		rq.setHeader('user-agent', 'njsrv');
		rq.setHeader('content-length', length);
		rq.setHeader('content-type', 
			'multipart/form-data; boundary=' + form.getBoundary());
	});
}



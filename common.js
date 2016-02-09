
const STATUS_FILE = 'status.txt';
const ORG_DIR = 'org/';

// determines that 'val' is a number value
function isNumber(val, len, str) {
    if (val == "") {
		alert("Поле '" + str + "' должно быть заполнено.");
		return false;
	}
	if ( !(/^[0-9]+$/.test(val)) ) {
		alert("Поле '" + str + "' должно содержать только цифры.");
		return false;
	}
 	// if len=0 - the length is not to be controlled
	if ((len != 0) && (val.length != len) ) {
		alert("Поле '" + str + "' должно содержать " + len + " символов.");
		return false;
	}
	return true;	
}


// status string updater
function loadStatusOnce() {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', STATUS_FILE, true); // asynchronous request
	xhr.send();

	xhr.onreadystatechange = function() {
		if (xhr.readyState != 4) 
			return;
		if (xhr.status == 200) 
			footer.innerHTML = xhr.responseText;
	}
}

function loadStatus() {
	loadStatusOnce();
	setInterval(function() {
		loadStatusOnce();
	}, 1000);
}

// checks if the 'inn' already exists in 'org' directory
function validateNewOrg(inn) {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', ORG_DIR + inn + '.xml', false); // synchronous request
	xhr.send();

	if (xhr.status == 200) { // OK
		return confirm('Организация с указанным ИНН уже существует.\n' + 
			'Вы действительно хотите перезапросить данные?');
	} else if (xhr.status == 404) {  // not found
		return true;
	}

	return false;
}

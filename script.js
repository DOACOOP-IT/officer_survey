/**
 * ระบบประเมินความพึงพอใจการให้บริการเจ้าหน้าที่
 * สหกรณ์ออมทรัพย์กรมวิชาการเกษตร จำกัด
 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxdJxJJMaB4MbESCEvmXShENHQ5OABt2in26CTS2MKFqkh_v9DRjvOu74FJRU0kNIF9/exec';
const SURVEY_FRONTEND_URL = 'https://doacoop-it.github.io/officer_survey/';
const SURVEY_LIFF_URL = 'https://liff.line.me/2011164567-UjK6uTMI';
const REGISTER_LIFF = 'https://liff.line.me/2011164567-xmPJaYwb';
const MY_LIFF_ID = '2011164567-UjK6uTMI';

// --- Global State ---
let allStaffData = [];
let webAppUrl = "";
let gateToken = "";
let serverStaffId = "";
let serverIsAdmin = "false";
let scanTime = "";
let currentAvatarUrl = "";

// --- Caching Helpers (Instant Load) ---
const AUTH_CACHE_KEY = 'officer_survey_auth_cache_v1';
const AUTH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 วัน
const STAFF_CACHE_PREFIX = 'officer_survey_staff_';
const STAFF_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 ชม.

function getCachedAuth(lineUid) {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.lineUid === lineUid && (Date.now() - data.timestamp) < AUTH_CACHE_TTL) {
      return data;
    }
  } catch (e) {}
  return null;
}

function setCachedAuth(lineUid, memberData) {
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
      lineUid: lineUid,
      memberData: memberData,
      timestamp: Date.now()
    }));
  } catch (e) {}
}

function clearAllAuthCache() {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
    localStorage.removeItem('officer_survey_member_no');
    localStorage.removeItem('officer_survey_member_name');
  } catch (e) {}
}

function getCachedStaff(staffId) {
  try {
    const raw = localStorage.getItem(STAFF_CACHE_PREFIX + staffId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if ((Date.now() - data.timestamp) < STAFF_CACHE_TTL) {
      return data.staff;
    }
  } catch(e) {}
  return null;
}

function setCachedStaff(staffId, staff) {
  try {
    localStorage.setItem(STAFF_CACHE_PREFIX + staffId, JSON.stringify({
      staff: staff,
      timestamp: Date.now()
    }));
  } catch(e) {}
}

// --- Session Management (10 นาที) ---
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 นาที
let sessionStartTime = null;
let sessionTimerInterval = null;

function startSessionTimer() {
  sessionStartTime = Date.now();
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(checkSessionExpiry, 5000);
}

function checkSessionExpiry() {
  if (!sessionStartTime) return;
  if (Date.now() - sessionStartTime >= SESSION_TIMEOUT_MS) {
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);
    sessionStartTime = null;
    handleSessionExpired();
  }
}

function handleSessionExpired() {
  Swal.fire({
    icon: 'warning',
    title: 'หมดเวลาทำรายการ',
    html: 'เซสชันการประเมินหมดอายุ (เกิน 10 นาที)<br>กรุณาสแกน QR Code ใหม่อีกครั้ง',
    confirmButtonText: '<i class="fas fa-redo"></i> สแกนใหม่',
    confirmButtonColor: '#667eea',
    allowOutsideClick: false
  }).then(function() {
    serverStaffId = "";
    resetEvaluationForm();
    switchView('view-error');
    if (window.history && window.history.replaceState) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  });
}

// --- UI Utilities ---
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(function(view) {
    view.classList.remove('active-view');
  });
  var target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active-view');
  }
}

function updateRealTimeClock() {
  var now = new Date();
  var options = { 
    timeZone: 'Asia/Bangkok', 
    hour12: false,
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  };
  
  var dateStr = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric' });
  var timeStr = now.toLocaleTimeString('th-TH', options) + ' น.';
  
  var liveTimeElements = document.querySelectorAll('.live-time');
  if (liveTimeElements.length > 0) {
    liveTimeElements.forEach(function(el) {
      el.textContent = dateStr + ' เวลา ' + timeStr;
    });
  }
}

// --- Avatar & Lightbox ---
function setStaffAvatar(imageUrl, showImage) {
  var img = document.getElementById('staffAvatarImg');
  var icon = document.getElementById('staffAvatarIcon');
  var box = document.getElementById('staffAvatar');
  if (!img || !icon || !box) return;

  currentAvatarUrl = '';
  box.classList.remove('has-photo');
  box.removeAttribute('title');

  var url = (imageUrl || '').toString().trim();
  var shouldShow = (showImage !== false && showImage !== 'FALSE');
  if (!url || !shouldShow) {
    img.removeAttribute('src');
    img.style.display = 'none';
    icon.style.display = '';
    return;
  }

  img.onerror = function() {
    currentAvatarUrl = '';
    box.classList.remove('has-photo');
    box.removeAttribute('title');
    img.style.display = 'none';
    icon.style.display = '';
  };
  img.onload = function() {
    currentAvatarUrl = url;
    box.classList.add('has-photo');
    box.title = 'กดเพื่อดูรูปเต็ม';
    img.style.display = 'block';
    icon.style.display = 'none';
  };
  img.style.display = 'none';
  icon.style.display = '';
  img.src = url;
}

function openAvatarLightbox() {
  if (!currentAvatarUrl) return;
  var box = document.getElementById('avatarLightbox');
  var img = document.getElementById('lightboxImg');
  var caption = document.getElementById('lightboxCaption');
  if (!box || !img) return;

  img.src = currentAvatarUrl;
  img.alt = 'รูปถ่ายของ ' + document.getElementById('staffName').textContent;
  if (caption) {
    caption.textContent = document.getElementById('staffName').textContent +
      ' • ' + document.getElementById('staffCounter').textContent;
  }

  box.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAvatarLightbox() {
  var box = document.getElementById('avatarLightbox');
  if (!box) return;
  box.classList.remove('open');
  document.body.style.overflow = '';
}

function bindLightboxEvents() {
  var avatar = document.getElementById('staffAvatar');
  var box = document.getElementById('avatarLightbox');
  var closeBtn = document.getElementById('lightboxClose');
  if (!avatar || !box) return;

  avatar.addEventListener('click', openAvatarLightbox);
  box.addEventListener('click', function(e) {
    if (e.target === box) closeAvatarLightbox();
  });
  if (closeBtn) {
    closeBtn.addEventListener('click', closeAvatarLightbox);
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && box.classList.contains('open')) {
      closeAvatarLightbox();
    }
  });
}

// --- GAS API Calling ---
async function callGasApi(action, payload, retryCount) {
  var maxRetries = 2;
  var attempt = retryCount || 0;

  try {
    var response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, data: payload, ...payload }),
      redirect: 'follow'
    });

    var text = await response.text();
    if (text.trim().startsWith('<')) {
      if (attempt < maxRetries) {
        await new Promise(function(r) { setTimeout(r, 1000); });
        return callGasApi(action, payload, attempt + 1);
      }
      throw new Error('เซิร์ฟเวอร์ตอบกลับผิดปกติ กรุณาปิดแล้วเปิดใหม่อีกครั้ง');
    }

    return JSON.parse(text);
  } catch (error) {
    if (attempt < maxRetries && error.message && error.message.indexOf('Failed to fetch') !== -1) {
      await new Promise(function(r) { setTimeout(r, 1000); });
      return callGasApi(action, payload, attempt + 1);
    }
    console.error('Error calling GAS API:', error);
    throw error;
  }
}

// --- Application Flow ---
window.addEventListener('load', function() {
  const sd = document.getElementById('serverData');
  if (sd) {
    serverStaffId = sd.getAttribute('data-staff-id') || "";
    serverIsAdmin = sd.getAttribute('data-is-admin') || "false";
    scanTime = sd.getAttribute('data-scan-time') || "";
    gateToken = sd.getAttribute('data-gate-token') || "";
  }

  // Setup Clock & Inputs
  updateRealTimeClock();
  setInterval(updateRealTimeClock, 1000);
  bindLightboxEvents();

  var commentInput = document.getElementById('commentInput');
  if (commentInput) {
    commentInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });
  }

  var ratingInputs = document.querySelectorAll('input[name="rating"]');
  ratingInputs.forEach(function(radio) {
    radio.addEventListener('click', function(e) {
      if (this.previousChecked) {
        this.checked = false;
        this.previousChecked = false;
      } else {
        ratingInputs.forEach(function(r) { r.previousChecked = false; });
        this.previousChecked = true;
      }
    });
  });

  startAppLogic();
});

function startAppLogic() {
  document.querySelectorAll('.view-section').forEach(function(el) {
    el.classList.remove('active-view');
  });

  if (serverIsAdmin === "true") {
    var isDone = false;
    setTimeout(function() { if(!isDone) onGetAllStaffFailure('Timeout: Backend taking too long.'); }, 15000);
    
    callGasApi('getStaffData', { fetchAll: true })
      .then(function(res) { isDone = true; onGetAllStaffSuccess(res); })
      .catch(function(err) { isDone = true; onGetAllStaffFailure(err); });
  } else if (serverStaffId) {
    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('loadingSpinner').classList.add('active-view');
    initLiffAndCheckAuth();
  } else {
    switchView('view-error');
  }
}

function initLiffAndCheckAuth() {
  // 1. Instant Staff Render (ถ้ามีแคชในเครื่อง ให้เปิดหน้าประเมินทันที 0ms)
  var cachedStaff = getCachedStaff(serverStaffId);
  if (cachedStaff) {
    renderStaffUI(cachedStaff);
  }

  liff.init({ liffId: MY_LIFF_ID })
    .then(function() {
      if (!liff.isLoggedIn()) {
        liff.login();
      } else {
        liff.getProfile().then(function(profile) {
          var lineUid = profile.userId;
          gateToken = lineUid;
          var savedMemNo = localStorage.getItem('officer_survey_member_no') || '';

          // 2. เรียก Fast 1-Shot API: ตรวจสิทธิ์ + ดึงข้อมูลเจ้าหน้าที่ในรอบเดียว
          callGasApi('getEvaluationInitData', { lineUid: lineUid, staffId: serverStaffId, memberNo: savedMemNo })
            .then(function(res) {
              if (res && res.success) {
                if (res.memberData && res.memberData.memberNo) {
                  localStorage.setItem('officer_survey_member_no', res.memberData.memberNo);
                  localStorage.setItem('officer_survey_member_name', res.memberData.name || '');
                  setCachedAuth(lineUid, res.memberData);
                }
                if (res.staff) {
                  setCachedStaff(serverStaffId, res.staff);
                  renderStaffUI(res.staff);
                } else {
                  onGetStaffFailure('ไม่พบข้อมูลเจ้าหน้าที่ประจำเคาน์เตอร์นี้');
                }
              } else if (res && res.requireRegistration) {
                clearAllAuthCache();
                redirectToRegistration();
              } else {
                clearAllAuthCache();
                onGetStaffFailure(res ? res.message : 'ตรวจสอบสิทธิ์ล้มเหลว');
              }
            })
            .catch(function(err) {
              onGetStaffFailure('เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว: ' + (err.message || err));
            });
        }).catch(function(err) {
          onGetStaffFailure('ดึงข้อมูล LINE ไม่สำเร็จ: ' + (err.message || err));
        });
      }
    })
    .catch(function(err) {
      onGetStaffFailure('LIFF Init Failed: ' + (err.message || err));
    });
}

function renderStaffUI(staff) {
  document.getElementById('loadingSpinner').style.display = 'none';
  if (!staff) return;

  document.getElementById('staffName').textContent = staff.name;
  document.getElementById('staffDept').textContent = staff.department;
  document.getElementById('staffCounter').textContent = staff.counter;
  setStaffAvatar(staff.imageUrl, staff.showImage);

  if (document.getElementById('displayScanTime')) {
    document.getElementById('displayScanTime').innerText = scanTime;
  }

  resetEvaluationForm();
  switchView('view-evaluation');
  startSessionTimer();
}

function redirectToRegistration() {
  clearAllAuthCache();
  window.location.replace(REGISTER_LIFF);
}

function onGetStaffFailure(err) {
  document.getElementById('loadingSpinner').style.display = 'none';
  Swal.fire({
    icon: 'error',
    title: 'ข้อผิดพลาดการเชื่อมต่อ',
    text: 'ไม่สามารถโหลดข้อมูลเจ้าหน้าที่ได้: ' + (err ? err.toString() : ''),
    confirmButtonColor: '#0ea5e9'
  });
  switchView('view-error');
}

function onGetAllStaffSuccess(response) {
  document.getElementById('loadingSpinner').style.display = 'none';
  allStaffData = response.staffList || [];
  webAppUrl = response.webAppUrl || "";

  renderSimulationGrid();
  renderQRGrid();
  switchView('view-landing');
}

function onGetAllStaffFailure(err) {
  document.getElementById('loadingSpinner').style.display = 'none';
  Swal.fire({
    icon: 'error',
    title: 'ข้อผิดพลาดระบบ',
    text: 'ไม่สามารถติดต่อฐานข้อมูลรายชื่อเจ้าหน้าที่ได้: ' + (err ? err.toString() : ''),
    confirmButtonColor: '#0ea5e9'
  });
}

function renderSimulationGrid() {
  var grid = document.getElementById('simulationGrid');
  if (!grid) return;
  grid.innerHTML = '';
  
  allStaffData.forEach(function(staff) {
    var card = document.createElement('div');
    card.className = 'staff-card';
    card.innerHTML =
      '<div class="staff-card-avatar">' +
        '<i class="fas fa-user"></i>' +
      '</div>' +
      '<div class="staff-card-info">' +
        '<div class="name">' + escapeHtml(staff.name) + '</div>' +
        '<div class="meta">' + escapeHtml(staff.department) + ' • ' + escapeHtml(staff.counter) + '</div>' +
      '</div>';

    if (staff.imageUrl && staff.imageUrl.trim() !== '') {
      var avatarBox = card.querySelector('.staff-card-avatar');
      var avatarImg = document.createElement('img');
      avatarImg.alt = '';
      avatarImg.onload = function() { avatarBox.innerHTML = ''; avatarBox.appendChild(avatarImg); };
      avatarImg.src = staff.imageUrl.trim();
    }

    card.onclick = function() {
      simulateScan(staff);
    };
    grid.appendChild(card);
  });
}

function renderQRGrid() {
  var grid = document.getElementById('qrGrid');
  var printSheet = document.getElementById('printSheet');
  if (!grid || !printSheet) return;
  grid.innerHTML = '';
  printSheet.innerHTML = '';
  
  var warn = document.getElementById('urlWarning');
  if (warn) warn.style.display = 'none';

  allStaffData.forEach(function(staff) {
    var evaluationUrl = SURVEY_FRONTEND_URL + '?counter=' + encodeURIComponent(staff.id);
    var targetUrl = 'line://app/2010640180-E85OIlZ4?returnUrl=' + encodeURIComponent(evaluationUrl);
    var qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(targetUrl);

    var safeName = escapeHtml(staff.name);
    var safeDept = escapeHtml(staff.department);
    var safeCounter = escapeHtml(staff.counter);

    var card = document.createElement('div');
    card.className = 'qr-card';
    card.innerHTML =
      '<div class="qr-image-container">' +
        '<img class="qr-image" src="' + qrApiUrl + '" alt="QR Code ของ ' + safeName + '" />' +
      '</div>' +
      '<div class="qr-details">' +
        '<div>' +
          '<div class="name">' + safeName + '</div>' +
          '<div class="meta">' + safeDept + '<br>' + safeCounter + '</div>' +
        '</div>' +
        '<div class="qr-actions">' +
          '<button class="btn-qr-action btn-qr-link" data-action="open">' +
            '<i class="fas fa-external-link-alt"></i> เปิดประเมิน' +
          '</button>' +
          '<a class="btn-qr-action btn-qr-download" href="' + qrApiUrl + '" target="_blank" rel="noopener" download="QR_' + encodeURIComponent(staff.id) + '.png">' +
            '<i class="fas fa-download"></i> โหลด QR' +
          '</a>' +
        '</div>' +
      '</div>';

    var openBtn = card.querySelector('[data-action="open"]');
    if (openBtn) {
      openBtn.onclick = function() { window.open(targetUrl, '_blank', 'noopener'); };
    }
    grid.appendChild(card);

    var printCard = document.createElement('div');
    printCard.className = 'print-qr-card';
    printCard.innerHTML =
      '<div class="print-title">สแกนเพื่อประเมินความพึงพอใจ</div>' +
      '<div class="print-meta">' + safeName + '</div>' +
      '<div class="print-meta">' + safeDept + ' • ' + safeCounter + '</div>' +
      '<img class="print-qr-image" src="' + qrApiUrl + '" alt="QR Code" />' +
      '<div style="font-size: 11px; color: #777; margin-top: 5px;">สแกนคิวอาร์โค้ดด้านบนเพื่อร่วมประเมิน</div>';
    printSheet.appendChild(printCard);
  });
}

function simulateScan(staff) {
  document.getElementById('staffName').textContent = staff.name;
  document.getElementById('staffDept').textContent = staff.department;
  document.getElementById('staffCounter').textContent = staff.counter;
  setStaffAvatar(staff.imageUrl, staff.showImage);

  var now = new Date();
  var year = now.getFullYear() + 543;
  var pad = function(n) { return n < 10 ? '0'+n : n; };
  scanTime = pad(now.getDate()) + '/' + pad(now.getMonth()+1) + '/' + year + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

  if (document.getElementById('displayScanTime')) {
    document.getElementById('displayScanTime').innerText = scanTime;
  }
  resetEvaluationForm();
  switchView('view-evaluation');
  startSessionTimer();
}

function switchAdminTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.remove('active');
  });
  document.getElementById('simContainer').style.display = 'none';
  document.getElementById('qrContainer').style.display = 'none';

  if (tabName === 'sim') {
    var btnSim = document.querySelector('[onclick="switchAdminTab(\'sim\')"]');
    if (btnSim) btnSim.classList.add('active');
    document.getElementById('simContainer').style.display = 'block';
  } else {
    var btnQr = document.querySelector('[onclick="switchAdminTab(\'qr\')"]');
    if (btnQr) btnQr.classList.add('active');
    document.getElementById('qrContainer').style.display = 'block';
  }
}

function setLayout(mode) {
  var simGrid = document.getElementById('simulationGrid');
  var qrGrid = document.getElementById('qrGrid');
  var btnGrid = document.getElementById('btnGrid');
  var btnList = document.getElementById('btnList');
  
  if (mode === 'list') {
    if (simGrid) simGrid.classList.add('list-view');
    if (qrGrid) qrGrid.classList.add('list-view');
    if (btnGrid) btnGrid.classList.remove('active');
    if (btnList) btnList.classList.add('active');
  } else {
    if (simGrid) simGrid.classList.remove('list-view');
    if (qrGrid) qrGrid.classList.remove('list-view');
    if (btnList) btnList.classList.remove('active');
    if (btnGrid) btnGrid.classList.add('active');
  }
}

function resetEvaluationForm() {
  if (!document.getElementById('commentInput')) return;

  var ratingInputs = document.querySelectorAll('input[name="rating"]');
  ratingInputs.forEach(function(radio) {
    radio.checked = false;
    radio.previousChecked = false;
  });

  var commentBox = document.getElementById('commentInput');
  commentBox.value = '';
  commentBox.style.height = '';
}

function submitEvaluation() {
  // 0. ตรวจสอบอายุเซสชัน 10 นาที
  if (sessionStartTime && (Date.now() - sessionStartTime >= SESSION_TIMEOUT_MS)) {
    handleSessionExpired();
    return;
  }

  // 1. ตรวจสอบการเลือกคะแนนความพึงพอใจ
  var ratingInput = document.querySelector('input[name="rating"]:checked');
  if (!ratingInput) {
    Swal.fire({
      icon: 'warning',
      title: 'ข้อมูลไม่ครบถ้วน',
      text: 'กรุณาเลือกระดับความพึงพอใจก่อนส่งประเมิน',
      confirmButtonColor: 'var(--warning-color)'
    });
    return;
  }

  var btnSubmit = document.getElementById('btnSubmitForm');
  btnSubmit.classList.add('loading');
  btnSubmit.disabled = true;

  var payload = {
    staffName: document.getElementById('staffName').textContent,
    department: document.getElementById('staffDept').textContent,
    counter: document.getElementById('staffCounter').textContent,
    scanTime: scanTime,
    rating: ratingInput.value,
    comment: document.getElementById('commentInput').value.trim(),
    token: gateToken,
    memberNo: localStorage.getItem('officer_survey_member_no') || '',
    isAdmin: serverIsAdmin === "true",
    signatureBase64: ""
  };

  callGasApi('submitEvaluation', payload)
    .then(onSubmitSuccess)
    .catch(onSubmitFailure);
}

function onSubmitSuccess(result) {
  var btnSubmit = document.getElementById('btnSubmitForm');
  btnSubmit.classList.remove('loading');
  btnSubmit.disabled = false;

  if (result.success || result.status === 'success') {
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);
    sessionStartTime = null;

    Swal.fire({
      icon: 'success',
      title: 'ส่งแบบประเมินสำเร็จ!',
      html: 'ขอบคุณสำหรับความคิดเห็น<br>ทางเราจะนำไปพัฒนาการบริการให้ดียิ่งขึ้น',
      confirmButtonText: '<i class="fas fa-check"></i> ตกลง',
      confirmButtonColor: '#22c55e',
      allowOutsideClick: false
    }).then(function(res) {
      if (typeof liff !== 'undefined' && liff.isInClient()) {
        liff.closeWindow();
      } else {
        resetEvaluationForm();
        switchView('view-error');
      }
    });
  } else {
    Swal.fire({
      icon: 'error',
      title: 'บันทึกข้อมูลไม่สำเร็จ',
      text: result.message,
      confirmButtonColor: 'var(--danger-color)'
    });
  }
}

function onSubmitFailure(errorMsg) {
  var btnSubmit = document.getElementById('btnSubmitForm');
  btnSubmit.classList.remove('loading');
  btnSubmit.disabled = false;

  Swal.fire({
    icon: 'error',
    title: 'ส่งไม่สำเร็จ',
    text: 'ระบบขัดข้อง: ' + errorMsg,
    confirmButtonColor: 'var(--danger-color)'
  });
}

function printQRCodes() {
  window.print();
}
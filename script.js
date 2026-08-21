const GAS_URL = 'https://script.google.com/macros/s/AKfycbxdJxJJMaB4MbESCEvmXShENHQ5OABt2in26CTS2MKFqkh_v9DRjvOu74FJRU0kNIF9/exec';

// QR Code เปิดหน้า GitHub Pages ผ่านระบบลงทะเบียนกลาง เพื่อรับ gate token ก่อนประเมิน
const SURVEY_FRONTEND_URL = 'https://doacoop-it.github.io/officer_survey/';
const SURVEY_LIFF_URL = 'https://liff.line.me/2011164567-UjK6uTMI';
const REGISTER_LIFF = 'https://liff.line.me/2011164567-xmPJaYwb';
const MY_LIFF_ID = '2011164567-UjK6uTMI';

// --- Auth Cache Helper (เพื่อเพิ่มความเร็วในการ Login) ---
const AUTH_CACHE_KEY = 'officer_survey_auth_cache_v1';
const AUTH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

// --- Staff Cache Helper (โหลด UI เจ้าหน้าที่ทันที 0ms) ---
const STAFF_CACHE_PREFIX = 'officer_survey_staff_';
const STAFF_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 ชม.

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
 // 7 วัน

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

// --- Session Management (10 นาที) ---
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 นาที (600,000 ms)
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



/**
 * เรียก GAS API พร้อมรองรับ redirect ที่อาจทำงานผิดพลาดบน LINE WebView
 * - อ่าน response เป็น text ก่อนแล้วค่อย parse JSON
 * - ถ้าได้ HTML กลับมา (GAS redirect พัง) จะลองใหม่อัตโนมัติ สูงสุด 2 ครั้ง
 */
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

    // ตรวจสอบว่า response เป็น JSON จริงหรือไม่
    if (text.trim().startsWith('<')) {
      // ได้ HTML กลับมาแทน JSON (GAS redirect พังบน mobile)
      if (attempt < maxRetries) {
        // รอ 1 วินาทีแล้วลองใหม่
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

var allStaffData = [];
  var webAppUrl = "";

  /**
   * แปลงข้อความให้ปลอดภัยก่อนนำไปต่อกับ innerHTML (ป้องกัน XSS)
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // เริ่มต้นระบบทันทีโดยไม่ต้องรอ DOMContentLoaded เนื่องจากสคริปต์อยู่ท้าย body
  updateRealTimeClock();
  setInterval(updateRealTimeClock, 1000);

  // Auto-resize textarea ของข้อเสนอแนะ
  var commentInput = document.getElementById('commentInput');
  if (commentInput) {
    commentInput.addEventListener('input', function() {
      this.style.height = 'auto'; // หดขนาดกลับไปก่อนเพื่อคำนวณใหม่
      this.style.height = this.scrollHeight + 'px'; // ปรับตามขนาดเนื้อหาจริง
    });
  }

  // ทำให้สามารถกดซ้ำที่ Emoji เพื่อยกเลิกการเลือกได้
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

  let gateToken = "";

  let serverStaffId = "";
  let serverIsAdmin = "false";
  let scanTime = "";

  window.addEventListener('load', () => {
    const sd = document.getElementById('serverData');
    if (sd) {
      serverStaffId = sd.getAttribute('data-staff-id') || "";
      serverIsAdmin = sd.getAttribute('data-is-admin') || "false";
      scanTime = sd.getAttribute('data-scan-time') || "";
      gateToken = sd.getAttribute('data-gate-token') || "";
    }
    startAppLogic();
  });

  function startAppLogic() {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active-view'));

    if (serverIsAdmin === "true") {
      // โหมดหน้าแอดมิน (?page=admin) - ไม่ต้องบังคับ LIFF login
      var isDone = false;
      setTimeout(function() { if(!isDone) onGetAllStaffFailure('Timeout: Backend taking too long.'); }, 15000);
      
      callGasApi('getStaffData', { fetchAll: true })
        .then(function(res) { isDone = true; onGetAllStaffSuccess(res); })
        .catch(function(err) { isDone = true; onGetAllStaffFailure(err); });
    } else if (serverStaffId) {
      // โหมดสแกน QR Code: เช็ค LIFF Login และ DB
      document.getElementById('loadingSpinner').style.display = 'block';
      document.getElementById('loadingSpinner').classList.add('active-view');
      
      initLiffAndCheckAuth();
    } else {
      // โหมดผู้ใช้งานทั่วไปที่ไม่ได้สแกน QR Code (ไม่มี ID)
      switchView('view-error');
    }
  }

  function initLiffAndCheckAuth() {
    // 1. Instant Staff Render (ถ้ามีแคชเจ้าหน้าที่ในเครื่อง ให้เปิดหน้าประเมินทันที 0ms)
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
                  redirectToRegistration();
                } else {
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
    window.location.replace(REGISTER_LIFF);
  }

  // URL รูปถ่ายที่โหลดสำเร็จแล้วของเจ้าหน้าที่คนปัจจุบัน ("" = ไม่มีรูปให้กดดู)
  var currentAvatarUrl = '';

  /**
   * แสดงรูปถ่ายเจ้าหน้าที่ในกรอบ avatar ของหน้าประเมิน
   * ถ้าไม่มีรูป หรือรูปโหลดไม่ขึ้น จะถอยกลับไปใช้ไอคอนเหมือนเดิม
   */
  function setStaffAvatar(imageUrl, showImage) {
    var img = document.getElementById('staffAvatarImg');
    var icon = document.getElementById('staffAvatarIcon');
    var box = document.getElementById('staffAvatar');
    if (!img || !icon || !box) return;

    // เริ่มจากสถานะ "ไม่มีรูป" เสมอ กันรูปคนก่อนหน้าค้าง
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

    // รูปจาก Google Drive อาจโหลดไม่ขึ้นถ้าสิทธิ์แชร์ยังไม่พร้อม จึงต้องมีทางถอย
    img.onerror = function() {
      currentAvatarUrl = '';
      box.classList.remove('has-photo');
      box.removeAttribute('title');
      img.style.display = 'none';
      icon.style.display = '';
    };
    img.onload = function() {
      currentAvatarUrl = url;
      box.classList.add('has-photo'); // เปิดให้กดดูรูปเต็มได้เฉพาะตอนโหลดสำเร็จ
      box.title = 'กดเพื่อดูรูปเต็ม';
      img.style.display = 'block';
      icon.style.display = 'none';
    };
    img.style.display = 'none';
    icon.style.display = '';
    img.src = url; // ตั้งค่าผ่าน property ไม่ใช่ innerHTML จึงไม่ต้อง escape
  }

  /**
   * เปิดกล่องดูรูปเต็ม (Lightbox)
   */
  function openAvatarLightbox() {
    if (!currentAvatarUrl) return; // ไม่มีรูปก็ไม่ต้องเปิด

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
    document.body.style.overflow = 'hidden'; // ล็อกไม่ให้หน้าหลังเลื่อนตาม
  }

  /**
   * ปิดกล่องดูรูปเต็ม
   */
  function closeAvatarLightbox() {
    var box = document.getElementById('avatarLightbox');
    if (!box) return;
    box.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ผูกปุ่มและการกดต่างๆ ของ Lightbox
  (function bindLightbox() {
    var avatar = document.getElementById('staffAvatar');
    var box = document.getElementById('avatarLightbox');
    var closeBtn = document.getElementById('lightboxClose');
    if (!avatar || !box) return;

    avatar.addEventListener('click', openAvatarLightbox);

    // กดที่พื้นหลังมืดเพื่อปิด (แต่กดที่ตัวรูปไม่ปิด)
    box.addEventListener('click', function(e) {
      if (e.target === box) closeAvatarLightbox();
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', closeAvatarLightbox);
    }

    // กด Esc เพื่อปิด
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && box.classList.contains('open')) {
        closeAvatarLightbox();
      }
    });
  })();


  /**
   * ระบบนาฬิกา Real-time แบบ พ.ศ. ของไทย
   */
  function updateRealTimeClock() {
    var now = new Date();
    var options = { 
      timeZone: 'Asia/Bangkok', 
      hour12: false,
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    };
    
    // แปลงเป็นปี พ.ศ.
    var dateStr = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric' });
    var timeStr = now.toLocaleTimeString('th-TH', options) + ' น.';
    
    var liveTimeElements = document.querySelectorAll('.live-time');
    if (liveTimeElements.length > 0) {
      liveTimeElements.forEach(function(el) {
        el.textContent = dateStr + ' เวลา ' + timeStr;
      });
    }
  }

  /**
   * ดึงข้อมูลเจ้าหน้าที่คนเดียวสำเร็จ
   */
  function onGetStaffSuccess(staff) {
    if (staff && staff.requireRegistration) {
      redirectToRegistration();
      return;
    }
    
    document.getElementById('loadingSpinner').style.display = 'none';
    if (staff) {
      // แสดงผลข้อมูลเจ้าหน้าที่
      document.getElementById('staffName').textContent = staff.name;
      document.getElementById('staffDept').textContent = staff.department;
      document.getElementById('staffCounter').textContent = staff.counter;
      setStaffAvatar(staff.imageUrl, staff.showImage);

      if (document.getElementById('displayScanTime')) {
        document.getElementById('displayScanTime').innerText = scanTime;
      }

      // รีเซ็ตฟอร์มก่อนแสดงผลเสมอ
      // (ย้ายมาไว้ที่นี่เพื่อให้แน่ใจว่า element ถูกสร้างแล้ว)
      resetEvaluationForm();
      
      switchView('view-evaluation');
      startSessionTimer();
    } else {
      Swal.fire({
        icon: 'error',
        title: 'ไม่พบข้อมูลเจ้าหน้าที่',
        text: 'รหัสเจ้าหน้าที่ที่ระบุไม่ถูกต้อง กรุณาสแกน QR Code อีกครั้ง',
        confirmButtonColor: '#0ea5e9'
      }).then(function() {
        // หากไม่พบเจ้าหน้าที่ ให้กลับไปหน้าแนะนำให้สแกนใหม่
        // (ไม่พาไปหน้าบอร์ดแอดมิน เพราะผู้ประเมินทั่วไปไม่ควรเห็น)
        switchView('view-error');
      });
    }
  }

  function onGetStaffFailure(err) {
    document.getElementById('loadingSpinner').style.display = 'none';
    Swal.fire({
      icon: 'error',
      title: 'ข้อผิดพลาดการเชื่อมต่อ',
      text: 'ไม่สามารถโหลดข้อมูลเจ้าหน้าที่ได้: ' + err.toString(),
      confirmButtonColor: '#0ea5e9'
    });
    switchView('view-error'); // ไม่ปล่อยให้จอว่างเปล่า
  }

  /**
   * ดึงข้อมูลเจ้าหน้าที่ทั้งหมด (สำหรับจำลองระบบ)
   */
  function onGetAllStaffSuccess(response) {
    document.getElementById('loadingSpinner').style.display = 'none';
    allStaffData = response.staffList;
    webAppUrl = response.webAppUrl;

    renderSimulationGrid();
    renderQRGrid();
    switchView('view-landing');
  }

  function onGetAllStaffFailure(err) {
    document.getElementById('loadingSpinner').style.display = 'none';
    Swal.fire({
      icon: 'error',
      title: 'ข้อผิดพลาดระบบ',
      text: 'ไม่สามารถติดต่อฐานข้อมูลรายชื่อเจ้าหน้าที่ได้: ' + err.toString(),
      confirmButtonColor: '#0ea5e9'
    });
  }

  /**
   * แสดงปุ่มจำลองสำหรับสแกนเจ้าหน้าที่ในหน้าแรก
   */
  function renderSimulationGrid() {
    var grid = document.getElementById('simulationGrid');
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

      // ถ้ามีรูปถ่าย ให้สลับไอคอนเป็นรูป (โหลดไม่ขึ้นก็คงไอคอนไว้เหมือนเดิม)
      if (staff.imageUrl && staff.imageUrl.trim() !== '') {
        var avatarBox = card.querySelector('.staff-card-avatar');
        var avatarImg = document.createElement('img');
        avatarImg.alt = '';
        avatarImg.onload = function() { avatarBox.innerHTML = ''; avatarBox.appendChild(avatarImg); };
        avatarImg.src = staff.imageUrl.trim();
      }

      // คลิกเพื่อเปิดหน้าประเมินเสมือนจริง
      card.onclick = function() {
        simulateScan(staff);
      };
      grid.appendChild(card);
    });
  }

  /**
   * แสดง QR Codes สำหรับสั่งพิมพ์
   */
  function renderQRGrid() {
    var grid = document.getElementById('qrGrid');
    var printSheet = document.getElementById('printSheet');
    grid.innerHTML = '';
    printSheet.innerHTML = '';
    
    // ชุด GitHub Pages ใช้ URL ของหน้าเว็บสาธารณะ ไม่ใช่ URL ของ Backend API
    document.getElementById('urlWarning').style.display = 'none';

    allStaffData.forEach(function(staff) {
      // ลองใช้ line:// scheme ฝังลงใน QR โดยตรง (ข้าม browser 100% แต่ขึ้นกับว่ากล้องมือถือรองรับหรือไม่)
      var evaluationUrl = SURVEY_FRONTEND_URL + '?counter=' + encodeURIComponent(staff.id);
      var targetUrl = 'line://app/2010640180-E85OIlZ4?returnUrl=' + encodeURIComponent(evaluationUrl);
      var qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(targetUrl);

      var safeName = escapeHtml(staff.name);
      var safeDept = escapeHtml(staff.department);
      var safeCounter = escapeHtml(staff.counter);

      // 1. สร้างการ์ดแสดงบนหน้าเว็บ (Web Card)
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

      // ผูกปุ่มด้วย JavaScript แทน inline onclick เพื่อไม่ให้ URL ที่มีอักขระพิเศษทำสคริปต์พัง
      var openBtn = card.querySelector('[data-action="open"]');
      if (openBtn) {
        openBtn.onclick = function() { window.open(targetUrl, '_blank', 'noopener'); };
      }
      grid.appendChild(card);

      // 2. สร้างการ์ดสำหรับสั่งพิมพ์หน้า A4 (Print Card)
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

  /**
   * จำลองการสแกน QR Code จากหน้าแรก
   */
  function simulateScan(staff) {
    document.getElementById('staffName').textContent = staff.name;
    document.getElementById('staffDept').textContent = staff.department;
    document.getElementById('staffCounter').textContent = staff.counter;
    setStaffAvatar(staff.imageUrl, staff.showImage);

    // ตั้งค่าเวลาแสกน ณ ตอนนั้น (พ.ศ.)
    var now = new Date();
    
    function getThaiFormattedTimeLocal(date) {
      if (!date) return "";
      var d = new Date(date);
      if (isNaN(d.getTime())) return "";
      var year = d.getFullYear() + 543;
      var pad = function(n) { return n < 10 ? '0'+n : n; };
      return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + year + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    scanTime = getThaiFormattedTimeLocal(now); // เก็บเวลาที่สแกนจำลองไว้ในตัวแปร global
    if (document.getElementById('displayScanTime')) {
      document.getElementById('displayScanTime').innerText = scanTime;
    }
    resetEvaluationForm(); // เริ่มประเมินคนใหม่ต้องได้ฟอร์มเปล่าเสมอ
    switchView('view-evaluation');
  }

  // ... (ส่วนที่เหลือของโค้ดเหมือนเดิม)

  /**
   * สลับแท็บในหน้าแอดมิน (Simulation vs QR Codes)
   */
  function switchAdminTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.classList.remove('active');
    });
    document.getElementById('simContainer').style.display = 'none';
    document.getElementById('qrContainer').style.display = 'none';

    if (tabName === 'sim') {
      document.querySelector('[onclick="switchAdminTab(\'sim\')"]').classList.add('active');
      document.getElementById('simContainer').style.display = 'block';
    } else {
      document.querySelector('[onclick="switchAdminTab(\'qr\')"]').classList.add('active');
      document.getElementById('qrContainer').style.display = 'block';
    }
  }

  /**
   * เปลี่ยนรูปแบบการแสดงผล Grid/List
   */
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

  /**
   * ล้างฟอร์ม
   */
  function resetEvaluationForm() {
    // ตรวจสอบว่า element พร้อมใช้งานหรือไม่ ก่อนจะรีเซ็ต
    if (!document.getElementById('commentInput')) return;

    // ล้างทั้งสถานะ checked และตัวจำ previousChecked
    // ถ้าไม่ล้าง previousChecked ผู้ใช้จะต้องกดอีโมจิเดิมสองครั้งหลังส่งฟอร์ม
    ratingInputs.forEach(function(radio) {
      radio.checked = false;
      radio.previousChecked = false;
    });

    var commentBox = document.getElementById('commentInput');
    commentBox.value = '';
    commentBox.style.height = ''; // คืนความสูงเดิมหลังพิมพ์ข้อความยาว
  }

  /**
   * ยื่นข้อมูลส่งผลการประเมิน
   */
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

    // ปิดการใช้งานปุ่มป้องกันการคลิกซ้ำซ้อน
    var btnSubmit = document.getElementById('btnSubmitForm');
    btnSubmit.classList.add('loading');
    btnSubmit.disabled = true; // Double protection

    // เตรียมชุดข้อมูล payload ส่งหลังบ้าน
    var payload = {
      staffName: document.getElementById('staffName').textContent,
      department: document.getElementById('staffDept').textContent,
      counter: document.getElementById('staffCounter').textContent,
      scanTime: scanTime, // ใช้เวลาดั้งเดิมที่เข้ามาในหน้าเว็บ หรือตอนกดจำลอง
      rating: ratingInput.value, // <-- *** FIX: Get value from star rating
      comment: document.getElementById('commentInput').value.trim(),
      // Backend ต้องตรวจ token กับระบบกลาง และใช้ข้อมูลสมาชิกจากผลตรวจเท่านั้น
      token: gateToken,
      memberNo: localStorage.getItem('officer_survey_member_no') || '',
      isAdmin: serverIsAdmin === "true",
      signatureBase64: ""
    };

    // ส่ง API ไปหาหลังบ้าน Google Apps Script
    callGasApi('submitEvaluation', payload)
      .then(onSubmitSuccess)
      .catch(onSubmitFailure);
  }

  /**
   * จัดการเมื่อส่งประเมินสำเร็จ
   */
  function onSubmitSuccess(result) {
    var btnSubmit = document.getElementById('btnSubmitForm');
    btnSubmit.classList.remove('loading');
    btnSubmit.disabled = false;

    if (result.success || result.status === 'success') {
      if (sessionTimerInterval) clearInterval(sessionTimerInterval);
      sessionStartTime = null;

      // แสดงกล่องสำเร็จ แล้วเมื่อกดปุ่ม ตกลง ให้ปิดหน้า LIFF ทันที
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

  /**
   * สั่งพิมพ์ QR Codes ทั้งหมดออกทางเครื่องพิมพ์
   */
  function printQRCodes() {
    window.print();
  }











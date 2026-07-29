/**
 * ==========================================================================
 * AI 감정일기장 (AI Emotion Diary) - 메인 자바스크립트 로직
 * 
 * Google Gemini AI API 연동 정보:
 * - Google AI Studio 발급 정식 API Key 적용 (스크린샷 원본 키)
 * - 최신 Gemini 1.5 Flash 모델 기반 정밀 맥락 감정 분석 및 따뜻한 조언 생성
 * 
 * 구글 Firebase Firestore DB 연동 정보:
 * - Project ID: my-diary-c79a2
 * - Storage Bucket: my-diary-c79a2.firebasestorage.app
 * - App ID: 1:103845743588:web:aa7d81dd02ebed482d15f1
 * ==========================================================================
 */

// ----------------------------------------------------------------------
// 1. Google Gemini AI API 및 Firebase Firestore 초기화 설정
// ----------------------------------------------------------------------

// 🌟 Google AI Studio 스크린샷의 원본 정식 API 키 (대소문자 정확 반영)
const GEMINI_API_KEY = "AQ.Ab8RN6LcOURUNKevjZIRCC03IOCf7hwF1zRl4dD1HS1vkvhljA";

// Firebase Firestore 데이터베이스 설정 정보
const firebaseConfig = {
  apiKey: "AIzaSyD0bawX7Mfoyou_jkHmR2XsWi3m15TvrKY",
  authDomain: "my-diary-c79a2.firebaseapp.com",
  projectId: "my-diary-c79a2",
  storageBucket: "my-diary-c79a2.firebasestorage.app",
  messagingSenderId: "103845743588",
  appId: "1:103845743588:web:aa7d81dd02ebed482d15f1"
};

let db = null;
let isFirestoreConnected = false;

// 전역 상태 변수
let isRecording = false;
let recognition = null;
let viewDate = new Date();
let selectedDateStr = getFormattedDateKey(new Date());

const USER_NAME_KEY = 'ai_diary_user_name';
const THEME_KEY = 'ai_diary_theme';
const DIARY_ENTRIES_PREFIX = 'ai_diary_entry_';
const PASSCODE_HASH_KEY = 'ai_diary_passcode_hash'; // SHA-256 암호화 해시 저장 키

// 날짜별 메모리 캐시 (빠른 데이터 로딩용)
let diaryCache = {};

// 페이지 로드가 완료되면 초기화 함수들을 순차적으로 실행합니다.
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    loadSavedSettings();
    renderCalendar();
    loadEntryForSelectedDate(selectedDateStr);
    setupSpeechRecognition();
    updatePasscodeUIStatus();
});

// Firebase DB 연동 초기화 함수
function initFirebase() {
    const dbBadge = document.getElementById('db-status-badge');
    try {
        if (typeof firebase !== 'undefined') {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            db = firebase.firestore();
            isFirestoreConnected = true;

            if (dbBadge) {
                dbBadge.textContent = '🔥 Firestore 연결 완료!';
                dbBadge.classList.add('connected');
            }
            console.log('Firebase Firestore DB 초기화 성공!');

            // Firestore 데이터 실시간 로드 시작
            loadDiariesFromFirestore();
            loadUserSettingsFromFirestore();
        } else {
            throw new Error('Firebase SDK 로드되지 않음');
        }
    } catch (error) {
        console.warn('Firebase 초기화 실패, 오프라인 모드로 동작합니다:', error);
        if (dbBadge) {
            dbBadge.textContent = '💾 오프라인 로컬 모드';
        }
        loadHistory();
    }
}

// ----------------------------------------------------------------------
// 2. 날짜 유틸리티 함수
// ----------------------------------------------------------------------

// Date 객체를 'YYYY-MM-DD' 키 형태로 변환하는 함수
function getFormattedDateKey(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 'YYYY-MM-DD' 문자열을 Date 객체로 파싱하는 함수
function parseDateKey(dateKeyStr) {
    const parts = dateKeyStr.split('-');
    return new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
}

// 한국어 날짜 표현 문자열 생성 함수 (예: 2026년 7월 29일 (수요일))
function getKoreanFullDateString(dateObj) {
    const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const date = dateObj.getDate();
    const dayName = days[dateObj.getDay()];
    return `${year}년 ${month}월 ${date}일 (${dayName})`;
}

// ----------------------------------------------------------------------
// 3. 🔒 선택형 비밀번호 설정 및 SHA-256 보안 암호화 함수
// ----------------------------------------------------------------------

/**
 * Web Crypto API를 사용하여 문자열을 SHA-256 해시로 암호화하는 함수
 * @param {string} text 평문 비밀번호
 * @returns {Promise<string>} Hex 문자열 해시값
 */
async function hashPassword(text) {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 상단 비밀번호 버튼 텍스트 상태 업데이트
function updatePasscodeUIStatus() {
    const isSet = !!localStorage.getItem(PASSCODE_HASH_KEY);
    const btnToggles = document.querySelectorAll('#btn-passcode-toggle, .btn-passcode-toggle');
    btnToggles.forEach(btn => {
        if (isSet) {
            btn.innerHTML = '🔑 비밀번호 설정됨';
            btn.style.borderColor = 'var(--accent-main)';
        } else {
            btn.innerHTML = '🔒 비밀번호 설정하기';
            btn.style.borderColor = 'var(--accent-border)';
        }
    });
}

// 비밀번호 설정 모달 열기
window.openPasscodeSetupModal = function() {
    const modal = document.getElementById('passcode-setup-modal');
    const input1 = document.getElementById('setup-passcode-input');
    const input2 = document.getElementById('confirm-passcode-input');
    const msg = document.getElementById('passcode-setup-msg');
    const btnRemove = document.getElementById('btn-remove-passcode');

    if (modal) {
        modal.classList.remove('hidden');
        if (input1) input1.value = '';
        if (input2) input2.value = '';
        if (msg) {
            msg.textContent = '';
            msg.className = 'modal-status-msg';
        }

        // 비밀번호가 설정되어 있으면 해제 버튼 노출
        const isSet = !!localStorage.getItem(PASSCODE_HASH_KEY);
        if (btnRemove) {
            if (isSet) btnRemove.classList.remove('hidden');
            else btnRemove.classList.add('hidden');
        }

        if (input1) input1.focus();
    }
};

window.closePasscodeSetupModal = function() {
    const modal = document.getElementById('passcode-setup-modal');
    if (modal) modal.classList.add('hidden');
};

// 비밀번호 신규 저장
window.savePasscode = async function() {
    const input1 = document.getElementById('setup-passcode-input');
    const input2 = document.getElementById('confirm-passcode-input');
    const msg = document.getElementById('passcode-setup-msg');

    const pass1 = input1 ? input1.value.trim() : '';
    const pass2 = input2 ? input2.value.trim() : '';

    if (!/^\d{4}$/.test(pass1)) {
        if (msg) {
            msg.textContent = '⚠️ 숫자 4자리를 정확히 입력해 주세요.';
            msg.className = 'modal-status-msg error';
        }
        if (input1) input1.focus();
        return;
    }

    if (pass1 !== pass2) {
        if (msg) {
            msg.textContent = '⚠️ 입력하신 두 비밀번호가 일치하지 않습니다.';
            msg.className = 'modal-status-msg error';
        }
        if (input2) input2.focus();
        return;
    }

    // SHA-256 암호화 해싱 수행
    const hashed = await hashPassword(pass1);
    localStorage.setItem(PASSCODE_HASH_KEY, hashed);

    // Firestore에도 유저 프로필 설정 저장
    if (isFirestoreConnected && db) {
        db.collection('user_settings').doc('profile').set({
            passcodeHash: hashed,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.warn('Firestore 비밀번호 해시 저장 실패:', err));
    }

    if (msg) {
        msg.textContent = '✨ 비밀번호 설정이 완료되었습니다!';
        msg.className = 'modal-status-msg success';
    }

    updatePasscodeUIStatus();

    setTimeout(() => {
        closePasscodeSetupModal();
    }, 1000);
};

// 비밀번호 설정 해제
window.removePasscode = function() {
    if (confirm('설정된 비밀번호를 해제하시겠습니까?')) {
        localStorage.removeItem(PASSCODE_HASH_KEY);

        if (isFirestoreConnected && db) {
            db.collection('user_settings').doc('profile').set({
                passcodeHash: null,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).catch(err => console.warn('Firestore 비밀번호 해제 오류:', err));
        }

        updatePasscodeUIStatus();
        closePasscodeSetupModal();
        alert('비밀번호 잠금이 해제되었습니다.');
    }
};

// 일기장 열기 버튼 클릭 시 비밀번호 설정 여부 제어
window.handleOpenDiaryClick = function() {
    const passcodeHash = localStorage.getItem(PASSCODE_HASH_KEY);

    // 비밀번호가 설정되어 있으면 인증 모달 노출, 없으면 바로 일기장 열기
    if (passcodeHash) {
        openPasscodeAuthModal();
    } else {
        openDiary();
    }
};

// 비밀번호 검증 모달 오픈
function openPasscodeAuthModal() {
    const modal = document.getElementById('passcode-auth-modal');
    const input = document.getElementById('auth-passcode-input');
    const msg = document.getElementById('passcode-auth-msg');

    if (modal) {
        modal.classList.remove('hidden');
        if (input) {
            input.value = '';
            input.focus();
        }
        if (msg) msg.textContent = '';
    }
}

window.closePasscodeAuthModal = function() {
    const modal = document.getElementById('passcode-auth-modal');
    if (modal) modal.classList.add('hidden');
};

// 비밀번호 검증 후 일기장 열기
window.verifyPasscodeAndOpen = async function() {
    const input = document.getElementById('auth-passcode-input');
    const msg = document.getElementById('passcode-auth-msg');
    const savedHash = localStorage.getItem(PASSCODE_HASH_KEY);

    const enteredPass = input ? input.value.trim() : '';

    if (!enteredPass) {
        if (msg) msg.textContent = '비밀번호를 입력해 주세요.';
        return;
    }

    const enteredHash = await hashPassword(enteredPass);

    if (enteredHash === savedHash) {
        closePasscodeAuthModal();
        openDiary();
    } else {
        if (msg) msg.textContent = '⚠️ 비밀번호가 올바르지 않습니다.';
        if (input) {
            input.value = '';
            input.focus();
        }
    }
};

// ----------------------------------------------------------------------
// 4. 📅 파스텔 마음 달력 (Calendar) 엔진
// ----------------------------------------------------------------------

// 달력 그리드를 동적으로 렌더링하는 함수
function renderCalendar() {
    const calendarDays = document.getElementById('calendar-days');
    const calendarMonthYear = document.getElementById('calendar-month-year');
    if (!calendarDays || !calendarMonthYear) return;

    calendarDays.innerHTML = '';

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    calendarMonthYear.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const firstDayOfWeek = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    // 1) 이전 달 빈 칸 채우기
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell other-month';
        dayCell.innerHTML = `<span class="day-number">${prevMonthLastDay - i}</span>`;
        calendarDays.appendChild(dayCell);
    }

    const todayStr = getFormattedDateKey(new Date());

    // 2) 이번 달 날짜 칸 생성
    for (let day = 1; day <= totalDays; day++) {
        const currentCellDate = new Date(year, month, day);
        const cellDateStr = getFormattedDateKey(currentCellDate);

        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell';

        if (cellDateStr === todayStr) {
            dayCell.classList.add('today');
        }
        if (cellDateStr === selectedDateStr) {
            dayCell.classList.add('selected');
        }

        const dayNumSpan = document.createElement('span');
        dayNumSpan.className = 'day-number';
        dayNumSpan.textContent = day;
        dayCell.appendChild(dayNumSpan);

        // 해당 날짜에 작성된 일기가 있으면 감정 이모지 스탬프 표시
        const savedEntry = getDiaryEntryByDate(cellDateStr);
        if (savedEntry && savedEntry.emoji) {
            const emojiStamp = document.createElement('span');
            emojiStamp.className = 'emoji-stamp';
            emojiStamp.textContent = savedEntry.emoji;
            emojiStamp.title = `${savedEntry.label}: ${savedEntry.text.substring(0, 30)}...`;
            dayCell.appendChild(emojiStamp);
        }

        dayCell.addEventListener('click', () => {
            selectDate(cellDateStr);
        });

        calendarDays.appendChild(dayCell);
    }

    // 3) 다음 달 빈 칸 채우기
    const totalRendered = firstDayOfWeek + totalDays;
    const nextDaysNeeded = (totalRendered % 7 === 0) ? 0 : 7 - (totalRendered % 7);

    for (let i = 1; i <= nextDaysNeeded; i++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell other-month';
        dayCell.innerHTML = `<span class="day-number">${i}</span>`;
        calendarDays.appendChild(dayCell);
    }
}

// 이전달/다음달 이동 함수
window.changeMonth = function(delta) {
    viewDate.setMonth(viewDate.getMonth() + delta);
    renderCalendar();
};

// 오늘 날짜로 이동하는 함수
window.selectToday = function() {
    viewDate = new Date();
    selectDate(getFormattedDateKey(new Date()));
};

// 특정 날짜 선택 함수
window.selectDate = function(dateStr) {
    selectedDateStr = dateStr;
    renderCalendar();
    loadEntryForSelectedDate(dateStr);
};

// 선택된 날짜의 일기 및 AI 분석 데이터 불러오기 함수
function loadEntryForSelectedDate(dateStr) {
    const selectedDateText = document.getElementById('selected-date-text');
    const diaryInput = document.getElementById('diary-input');
    const aiPlaceholder = document.getElementById('ai-placeholder');
    const aiLoading = document.getElementById('ai-loading');
    const aiResult = document.getElementById('ai-result');
    const aiResponseBox = document.getElementById('ai-response-box');
    const sentimentBadge = document.getElementById('sentiment-badge');
    const resultEmoji = document.getElementById('result-emoji');
    const resultLabel = document.getElementById('result-label');
    const resultMessage = document.getElementById('result-message');

    const dateObj = parseDateKey(dateStr);
    if (selectedDateText) {
        selectedDateText.textContent = `${getKoreanFullDateString(dateObj)} 일기 작성 중`;
    }

    const savedEntry = getDiaryEntryByDate(dateStr);

    if (savedEntry) {
        if (diaryInput) {
            diaryInput.value = savedEntry.text;
            updateCharCount();
        }

        if (savedEntry.emoji && resultEmoji && resultLabel && resultMessage) {
            resultEmoji.textContent = savedEntry.emoji;
            resultLabel.textContent = savedEntry.label;
            resultMessage.textContent = savedEntry.message;

            sentimentBadge.textContent = `대표 감정: ${savedEntry.label}`;
            sentimentBadge.classList.remove('hidden');

            aiPlaceholder.classList.add('hidden');
            aiLoading.classList.add('hidden');
            aiResult.classList.remove('hidden');
            if (aiResponseBox) aiResponseBox.classList.add('has-result');
        }
    } else {
        if (diaryInput) {
            diaryInput.value = '';
            updateCharCount();
        }

        if (aiPlaceholder && aiResult && aiResponseBox && sentimentBadge) {
            aiPlaceholder.classList.remove('hidden');
            aiLoading.classList.add('hidden');
            aiResult.classList.add('hidden');
            aiResponseBox.classList.remove('has-result');
            sentimentBadge.classList.add('hidden');
        }
    }
}

// ----------------------------------------------------------------------
// 5. Firestore DB & LocalStorage 하이브리드 데이터 동기화
// ----------------------------------------------------------------------

// 날짜별 일기 데이터 조회 함수
function getDiaryEntryByDate(dateStr) {
    if (diaryCache[dateStr]) {
        return diaryCache[dateStr];
    }
    const localData = localStorage.getItem(DIARY_ENTRIES_PREFIX + dateStr);
    return localData ? JSON.parse(localData) : null;
}

// 일기 데이터 저장 함수 (LocalStorage + Firestore 동시 저장)
function saveDiaryEntry(dateStr, entryObj) {
    // 1) 메모리 캐시 및 LocalStorage 즉시 동기화
    diaryCache[dateStr] = entryObj;
    localStorage.setItem(DIARY_ENTRIES_PREFIX + dateStr, JSON.stringify(entryObj));
    renderCalendar();

    // 2) Firestore DB 저장
    if (isFirestoreConnected && db) {
        db.collection('diaries').doc(dateStr).set({
            ...entryObj,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            console.log(`Firestore DB 저장 성공: ${dateStr}`);
        }).catch(err => {
            console.error('Firestore 저장 오류:', err);
        });
    }
}

// Firestore에서 작성된 모든 일기 실시간 수신 함수
function loadDiariesFromFirestore() {
    if (!isFirestoreConnected || !db) return;

    db.collection('diaries').onSnapshot(snapshot => {
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data && data.dateKey) {
                diaryCache[data.dateKey] = data;
                localStorage.setItem(DIARY_ENTRIES_PREFIX + data.dateKey, JSON.stringify(data));
            }
        });
        renderCalendar();
        loadEntryForSelectedDate(selectedDateStr);
        loadHistory();
    }, err => {
        console.warn('Firestore 실시간 데이터 수신 실패:', err);
    });
}

// 사용자 이름 및 테마 Firestore 저장 및 수신 함수
function saveUserSettingsToFirestore(userName, theme) {
    if (isFirestoreConnected && db) {
        db.collection('user_settings').doc('profile').set({
            userName: userName,
            theme: theme,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error('사용자 설정 Firestore 저장 오류:', err));
    }
}

function loadUserSettingsFromFirestore() {
    if (!isFirestoreConnected || !db) return;

    db.collection('user_settings').doc('profile').get().then(doc => {
        if (doc.exists) {
            const data = doc.data();
            if (data.theme) setTheme(data.theme, false);
            if (data.userName) {
                const nameInput = document.getElementById('user-name-input');
                if (nameInput) nameInput.value = data.userName;
                updateTitleWithUserName(data.userName);
            }
            if (data.passcodeHash) {
                localStorage.setItem(PASSCODE_HASH_KEY, data.passcodeHash);
                updatePasscodeUIStatus();
            }
        }
    }).catch(err => console.warn('사용자 설정 로드 오류:', err));
}

// ----------------------------------------------------------------------
// 6. 테마 및 사용자 이름 동적 변경
// ----------------------------------------------------------------------

// 저장된 환경설정 로드 함수
function loadSavedSettings() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'pink';
    setTheme(savedTheme, false);

    const nameInput = document.getElementById('user-name-input');
    const savedName = localStorage.getItem(USER_NAME_KEY) || '민지';
    if (nameInput) {
        nameInput.value = savedName;
    }
    updateTitleWithUserName(savedName);
}

// 테마 변경 함수
window.setTheme = function(themeName, shouldSaveToDb = true) {
    document.body.setAttribute('data-theme', themeName);
    localStorage.setItem(THEME_KEY, themeName);

    const themeBtns = document.querySelectorAll('.btn-theme');
    themeBtns.forEach(btn => {
        if (btn.classList.contains(`theme-${themeName}`)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (shouldSaveToDb) {
        const currentName = localStorage.getItem(USER_NAME_KEY) || '민지';
        saveUserSettingsToFirestore(currentName, themeName);
    }
};

// 사용자 이름 변경 시 호출되는 이벤트 핸들러
window.onNameChange = function() {
    const nameInput = document.getElementById('user-name-input');
    const inputVal = nameInput ? nameInput.value.trim() : '';
    const nameToShow = inputVal || '내';

    updateTitleWithUserName(nameToShow);
    localStorage.setItem(USER_NAME_KEY, inputVal);

    const currentTheme = localStorage.getItem(THEME_KEY) || 'pink';
    saveUserSettingsToFirestore(inputVal, currentTheme);
};

// 화면 타이틀에 사용자 이름 반영 함수
function updateTitleWithUserName(name) {
    const coverRibbon = document.getElementById('cover-ribbon-text');
    const mainBadge = document.getElementById('main-badge-text');
    const btnOpenText = document.getElementById('btn-open-text');

    const formattedTitle = `🌸 ${name}의 비밀 다이어리 🌸`;
    const formattedBadge = `🌸 ${name}의 마음 다이어리`;
    const formattedBtn = `${name}의 일기장 열기`;

    if (coverRibbon) coverRibbon.textContent = formattedTitle;
    if (mainBadge) mainBadge.textContent = formattedBadge;
    if (btnOpenText) btnOpenText.textContent = formattedBtn;
}

// ----------------------------------------------------------------------
// 7. 커버 <-> 메인 화면 전환
// ----------------------------------------------------------------------
window.openDiary = function() {
    const coverScreen = document.getElementById('cover-screen');
    const mainScreen = document.getElementById('main-screen');
    
    if (coverScreen && mainScreen) {
        coverScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

window.closeDiary = function() {
    const coverScreen = document.getElementById('cover-screen');
    const mainScreen = document.getElementById('main-screen');
    
    if (coverScreen && mainScreen) {
        mainScreen.classList.add('hidden');
        coverScreen.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

// ----------------------------------------------------------------------
// 8. 예시 글 채우기 기능
// ----------------------------------------------------------------------
const sampleDiaries = [
    "오늘 7시에 일어나려 했는데 8시에 일어나는 바람에 등교도 늦고 기하 숙제할 시간이 부족해서 너무 당황스럽고 초조해... 😱",
    "오늘 오랫동안 기다렸던 친구와 함께 카페에서 수다를 떨며 즐거운 시간을 보냈다! 너무 행복했다. 😃",
    "오늘 중요한 노트 일기장을 잃어버려서 마음이 우울하고 속상했다. 그래도 다시 기운을 내보려 한다. 😢",
    "약속 장소에 늦게 나온 친구가 당연하다는 듯 행동해서 화가 너무 났다. 😡",
    "주말 오후, 햇살 아래서 음악을 들으며 조용히 쉬었다. 평온하고 다정한 하루였다. 🌿"
];

let sampleIndex = 0;

window.fillSampleDiary = function() {
    const diaryInput = document.getElementById('diary-input');
    if (!diaryInput) return;

    const textToFill = sampleDiaries[sampleIndex % sampleDiaries.length];
    sampleIndex++;

    diaryInput.value = textToFill;
    updateCharCount();

    diaryInput.focus();
    diaryInput.style.borderColor = 'var(--accent-main)';
    setTimeout(() => {
        diaryInput.style.borderColor = 'var(--accent-border)';
    }, 500);
};

window.updateCharCount = function() {
    const diaryInput = document.getElementById('diary-input');
    const charCount = document.getElementById('char-count');
    if (diaryInput && charCount) {
        charCount.textContent = diaryInput.value.length;
    }
};

// ----------------------------------------------------------------------
// 9. 음성 입력 기능 (Web Speech API)
// ----------------------------------------------------------------------
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        try {
            recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'ko-KR';

            recognition.onresult = (event) => {
                const diaryInput = document.getElementById('diary-input');
                let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript + ' ';
                    }
                }
                if (finalTranscript && diaryInput) {
                    diaryInput.value += (diaryInput.value ? ' ' : '') + finalTranscript.trim();
                    updateCharCount();
                }
            };

            recognition.onerror = () => {
                showVoiceStatus('⚠️ 마이크 권한 확인이 필요합니다. 가상 음성 입력 모드로 동작합니다.', true);
            };

            recognition.onend = () => {
                if (isRecording) {
                    try { recognition.start(); } catch(e) { stopVoiceUI(); }
                } else {
                    stopVoiceUI();
                }
            };
        } catch(e) {}
    }
}

window.toggleVoiceInput = function() {
    const btnVoice = document.getElementById('btn-voice');
    const btnVoiceText = document.getElementById('btn-voice-text');

    if (!isRecording) {
        isRecording = true;
        if (btnVoice) btnVoice.classList.add('recording');
        if (btnVoiceText) btnVoiceText.textContent = '음성 입력 중지';
        showVoiceStatus('🎙️ 음성을 듣고 있어요... 말씀하시면 입력창에 적힙니다!');

        if (recognition) {
            try {
                recognition.start();
            } catch (err) {
                runSimulatedVoiceInput();
            }
        } else {
            runSimulatedVoiceInput();
        }
    } else {
        isRecording = false;
        if (recognition) {
            try { recognition.stop(); } catch(e){}
        }
        stopVoiceUI();
    }
};

function runSimulatedVoiceInput() {
    const simulatedPhrases = [
        "오늘 맛있는 음식을 먹고 가족들과 함께 웃으며 기분 좋았어 🍰",
        "갑자기 안 좋은 일이 있어서 슬프고 속상했던 하루였어 ☔",
        "조용한 카페에서 산책하며 마음을 정돈한 평온한 하루였어 ☕"
    ];

    showVoiceStatus('🎙️ [가상 음성 모드] 목소리를 들으며 글을 적는 중입니다...');

    setTimeout(() => {
        if (isRecording) {
            const diaryInput = document.getElementById('diary-input');
            const randomPhrase = simulatedPhrases[Math.floor(Math.random() * simulatedPhrases.length)];
            if (diaryInput) {
                diaryInput.value += (diaryInput.value ? '\n' : '') + randomPhrase;
                updateCharCount();
            }
            stopVoiceUI();
        }
    }, 1800);
}

function showVoiceStatus(msg, isError = false) {
    const voiceStatus = document.getElementById('voice-status');
    const voiceStatusText = document.getElementById('voice-status-text');
    if (voiceStatus && voiceStatusText) {
        voiceStatusText.textContent = msg;
        voiceStatus.classList.remove('hidden');
        if (isError) voiceStatus.classList.add('error');
        else voiceStatus.classList.remove('error');
    }
}

function stopVoiceUI() {
    isRecording = false;
    const btnVoice = document.getElementById('btn-voice');
    const btnVoiceText = document.getElementById('btn-voice-text');
    const voiceStatus = document.getElementById('voice-status');

    if (btnVoice) btnVoice.classList.remove('recording');
    if (btnVoiceText) btnVoiceText.textContent = '음성으로 입력하기';
    if (voiceStatus) voiceStatus.classList.add('hidden');
}

// ----------------------------------------------------------------------
// 10. ✨ Google Gemini AI API 실시간 연동 및 정밀 맥락 감정 분석
// ----------------------------------------------------------------------

/**
 * Google AI Studio Gemini API를 실시간 호출하여 세분화된 맥락 감정을 분석하는 비동기 함수
 * @param {string} text 사용자가 작성한 일기 내용
 * @returns {Promise<{emoji: string, label: string, message: string}>}
 */
async function callGeminiApi(text) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const userName = localStorage.getItem(USER_NAME_KEY) || '사용자';

    // 🌟 고도화된 감정 분석 지시 프롬프트 (맥락 인식 및 다양한 감정 카테고리 지정)
    const prompt = `
당신은 공감 능력이 뛰어난 따뜻한 심리 상담가이자 '${userName}'님의 다정한 비밀 다이어리 친구입니다.
작성된 아래 일기 내용을 매우 정밀하게 읽고, 단어 몇 개에 현혹되지 말고 **전체 상황의 맥락(예: 늦잠, 숙제를 못함, 시간 부족, 계획 어그러짐, 속상함, 초조함, 행복, 화남 등)**을 파악하여 가장 부합하는 대표 감정을 정해 주세요.

[선택 가능한 감정 카테고리 예시]
1) 😱 "당황과 초조함" (늦잠, 시간이 부족함, 숙제/시험 부담, 계획이 어그러짐, 조급함)
2) 😢 "슬픔과 속상함" (아쉬움, 자책, 우울, 눈물, 외로움)
3) 😡 "분노와 답답함" (화남, 억울함, 짜증, 분노)
4) 🩹 "지침과 걱정" (피곤함, 불안, 스트레스, 고민)
5) 😃 "기쁨과 행복" (즐거움, 성취감, 보람, 감사)
6) 🌿 "평온과 잔잔함" (여유, 휴식, 소소한 일상, 평화)

반드시 아래 JSON 형태로만 응답해 주세요. 마크다운 백틱(\`\`\`json ...) 없이 순수한 JSON만 반환해 주세요.

{
  "emoji": "해당 감정에 가장 어울리는 이모지 하나 (예: 😱, 😢, 😡, 🩹, 😃, 🌿 등)",
  "label": "대표 감정 이름 (위 카테고리 중 가장 적합한 이름)",
  "message": "'${userName}'님에게 전하는 진심 어린 공감과 따뜻한 위로, 현실적인 조언이나 격려의 글 (3~4문장, 한국어 다정한 어조)"
}

[일기 내용]
"${text.replace(/"/g, '\\"')}"
`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }]
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API 호출 실패 (상태 코드: ${response.status}): ${errText}`);
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
        throw new Error('Gemini API 응답에서 텍스트를 찾을 수 없습니다.');
    }

    // 마크다운 형식 태그 제거 후 순수 JSON 파싱
    const cleanedJsonText = candidateText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanedJsonText);

    return {
        emoji: result.emoji || '🌸',
        label: result.label || '마음의 소리',
        message: result.message || '오늘 하루도 정말 고생 많으셨어요.'
    };
}

// ✨ AI 감정 분석 요청 메인 함수 (비동기 async)
window.requestAnalysis = async function() {
    const diaryInput = document.getElementById('diary-input');
    const btnAnalyze = document.getElementById('btn-analyze');
    const aiPlaceholder = document.getElementById('ai-placeholder');
    const aiLoading = document.getElementById('ai-loading');
    const aiResult = document.getElementById('ai-result');
    const aiResponseBox = document.getElementById('ai-response-box');
    const sentimentBadge = document.getElementById('sentiment-badge');
    const resultEmoji = document.getElementById('result-emoji');
    const resultLabel = document.getElementById('result-label');
    const resultMessage = document.getElementById('result-message');

    if (!diaryInput) return;
    let text = diaryInput.value.trim();

    // 입력글이 없는 경우 예시 글 자동 입력 확인
    if (!text) {
        const autoFill = confirm('선택한 날짜의 일기 내용이 작성되지 않았어요! 😊\n\n[확인]을 누르시면 예시 글을 자동으로 채우고 바로 AI 감정 분석을 진행할까요?');
        if (autoFill) {
            fillSampleDiary();
            text = diaryInput.value.trim();
        } else {
            diaryInput.focus();
            return;
        }
    }

    if (isRecording) {
        isRecording = false;
        if (recognition) { try { recognition.stop(); } catch(e){} }
        stopVoiceUI();
    }

    // UI 상태: 로딩 애니메이션 표시
    aiPlaceholder.classList.add('hidden');
    aiResult.classList.add('hidden');
    aiLoading.classList.remove('hidden');
    if (aiResponseBox) aiResponseBox.classList.remove('has-result');
    if (sentimentBadge) sentimentBadge.classList.add('hidden');

    if (btnAnalyze) {
        btnAnalyze.disabled = true;
        btnAnalyze.style.opacity = '0.7';
    }

    try {
        let analysis;
        try {
            // 1) 🌟 실제 Google Gemini AI API 호출 시도 (정밀 맥락 감정 분석)
            console.log('✨ Google Gemini AI API에 정밀 맥락 감정 분석 요청 중...');
            analysis = await callGeminiApi(text);
            console.log('✨ Gemini AI 정밀 분석 성공:', analysis);
        } catch (apiError) {
            // 2) API 실패 시 안전한 백업(Fallback) 키워드 기반 로컬 감정 분석 실행
            console.warn('⚠️ Gemini API 연동 오류 발생, 향상된 로컬 감정 분석 백업 엔진으로 대체합니다:', apiError);
            analysis = analyzeEmotion(text);
        }

        // 결과 화면 UI 업데이트
        if (resultEmoji) resultEmoji.textContent = analysis.emoji;
        if (resultLabel) resultLabel.textContent = analysis.label;
        if (resultMessage) resultMessage.textContent = analysis.message;

        if (sentimentBadge) {
            sentimentBadge.textContent = `대표 감정: ${analysis.label}`;
            sentimentBadge.classList.remove('hidden');
        }

        aiLoading.classList.add('hidden');
        if (aiResult) aiResult.classList.remove('hidden');
        if (aiResponseBox) aiResponseBox.classList.add('has-result');

        // 🌟 Firestore DB 및 LocalStorage 데이터 동기화 저장
        saveDiaryEntry(selectedDateStr, {
            dateKey: selectedDateStr,
            dateText: getKoreanFullDateString(parseDateKey(selectedDateStr)),
            text: text,
            emoji: analysis.emoji,
            label: analysis.label,
            message: analysis.message
        });

        loadHistory();

    } catch (err) {
        console.error('분석 처리 중 예외 발생:', err);
        if (aiLoading) aiLoading.classList.add('hidden');
        if (aiPlaceholder) aiPlaceholder.classList.remove('hidden');
    } finally {
        if (btnAnalyze) {
            btnAnalyze.disabled = false;
            btnAnalyze.style.opacity = '1';
        }
    }
};

// ----------------------------------------------------------------------
// 11. 비상 백업(Fallback) 향상된 로컬 키워드 감정 분석 엔진
// ----------------------------------------------------------------------
function analyzeEmotion(text) {
    const keywords = {
        panic: ['시간이 없어', '숙제', '늦었', '어떡', '망했', '부족', '조급', '당황', '늦잠', '큰일', '망함', '초조', '못했어', '어쩌지'],
        joy: ['기쁨', '행복', '신나', '즐거', '웃음', '감사', '성공', '좋다', '좋았', '오예', '최고', '소중', '맛있는', '카페', '디저트', '수다'],
        sadness: ['슬프', '우울', '눈물', '외로', '서럽', '아프', '속상', '실망', '좌절', '마음이 아파', '힘들었', '상처', '잃어버', '울적'],
        anger: ['화가', '빡쳐', '열받', '짜증', '분노', '미워', '억울', '다퉜', '싸웠', '화나', '늦게'],
        peace: ['편안', '조용', '산책', '무난', '나른', '평화', '포근', '쉬었', '여유', '따뜻', '휴식', '음악', '창가', '정돈'],
        anxiety: ['걱정', '불안', '피곤', '지친', '스트레스', '잠이 안', '포기', '막막', '지침', '시험', '결과']
    };

    let scores = { panic: 0, joy: 0, sadness: 0, anger: 0, peace: 0, anxiety: 0 };

    for (const [emotion, wordList] of Object.entries(keywords)) {
        wordList.forEach(word => {
            if (text.includes(word)) {
                scores[emotion] += 1;
            }
        });
    }

    let dominantEmotion = 'peace';
    let maxScore = 0;

    for (const [emotion, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            dominantEmotion = emotion;
        }
    }

    if (maxScore === 0) {
        dominantEmotion = text.length < 20 ? 'peace' : 'anxiety';
    }

    const responseTemplates = {
        panic: {
            emoji: '😱',
            label: '당황과 초조함',
            messages: [
                `시간에 쫓기고 예상치 못한 상황 때문에 마음이 쿵쾅거리고 많이 당황스러우셨겠어요. ☕\n갑작스럽게 계획이 어그러지면 누구라도 조급해지고 속상하기 마련이에요.\n우선 고른 숨을 한번 내쉬어 보세요. 남은 시간 동안 할 수 있는 것부터 하나씩 차근차근 해내면 분명 잘 해결할 수 있을 거예요!`
            ]
        },
        joy: {
            emoji: '😃',
            label: '기쁨과 행복',
            messages: [
                `오늘 하루 정말 빛나는 기쁜 순간이 가득했군요! 🌸\n당신의 긍정적인 에너지가 글 너머로까지 따뜻하게 전해져요.\n이 행복했던 기억을 소중히 품고, 오늘 밤은 누구보다 편안하고 기분 좋은 꿈을 꾸시길 바랄게요.`
            ]
        },
        sadness: {
            emoji: '😢',
            label: '슬픔과 속상함',
            messages: [
                `마음이 여리고 슬픈 순간을 견디느라 오늘 하루 참 고생 많았어요. 🩹\n억지로 기운 차리지 않아도 괜찮으니, 지금은 당신의 지친 마음을 가만히 보듬어 주세요.\n어두운 밤이 지나면 반드시 따스한 햇살이 찾아오듯, 당신의 마음에도 곧 온기가 가득할 거예요.`
            ]
        },
        anger: {
            emoji: '😡',
            label: '분노와 답답함',
            messages: [
                `오늘 마음을 쓰라리게 만든 일 때문에 정말 속상하고 화가 나셨겠어요. ☕\n감정을 마음에 꾹꾹 눌러 담지 않고 이렇게 일기에 솔직하게 털어놓은 것만으로도 참 잘하셨어요.\n깊게 숨을 마시고 천천히 내쉬며, 마음속 나쁜 열기를 소중한 당신 밖으로 훌훌 털어내 보세요.`
            ]
        },
        peace: {
            emoji: '🌿',
            label: '평온과 잔잔함',
            messages: [
                `잔잔하고 평화로운 하루의 소소한 온기가 느껴지는 글이에요. ☕\n특별히 큰일이 없어도 조용히 지나가는 하루야말로 참 소중하고 감사한 선물이지요.\n지친 일상 속에서 잠시 숨을 고르며, 포근한 이불 속에서 오늘의 안락함을 마음껏 누려보세요.`
            ]
        },
        anxiety: {
            emoji: '🩹',
            label: '지침과 걱정',
            messages: [
                `수많은 생각과 걱정으로 오늘 하루 동안 마음이 많이 무거우셨겠어요. 🌙\n모든 짐을 혼자 짊어지려 하지 마세요. 당신은 이미 충분히 최선을 다해 잘 해내고 있답니다.\n지금 이 순간만큼은 내일의 걱정을 내려놓고, 지친 자신에게 따스한 위로의 다독임을 건네주세요.`
            ]
        }
    };

    const emotionData = responseTemplates[dominantEmotion];
    const selectedMessage = emotionData.messages[Math.floor(Math.random() * emotionData.messages.length)];

    return {
        emoji: emotionData.emoji,
        label: emotionData.label,
        message: selectedMessage
    };
}

// ----------------------------------------------------------------------
// 12. 과거 마음 기록장 목록 출력
// ----------------------------------------------------------------------
function loadHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;

    historyList.innerHTML = '';

    const entries = Object.values(diaryCache);

    entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    if (entries.length === 0) {
        historyList.innerHTML = '<p class="no-history">아직 저장된 마음 기록이 없어요. 달력에서 날짜를 눌러 일기를 작성해 보세요!</p>';
        return;
    }

    entries.forEach((item) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        historyItem.innerHTML = `
            <div class="history-info">
                <span class="history-emoji">${item.emoji}</span>
                <span class="history-snippet">${escapeHtml(item.text)}</span>
            </div>
            <span class="history-date">${item.dateKey}</span>
        `;

        historyItem.addEventListener('click', () => {
            viewDate = parseDateKey(item.dateKey);
            selectDate(item.dateKey);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        historyList.appendChild(historyItem);
    });
}

// 전체 마음 일기 기록 삭제 함수
window.clearDiaryHistory = function() {
    if (confirm('저장된 모든 마음 일기 기록을 비우시겠습니까?')) {
        diaryCache = {};
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(DIARY_ENTRIES_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        if (isFirestoreConnected && db) {
            db.collection('diaries').get().then(snapshot => {
                snapshot.forEach(doc => doc.ref.delete());
            }).catch(err => console.error('Firestore 데이터 삭제 중 오류:', err));
        }

        renderCalendar();
        loadHistory();
        selectDate(selectedDateStr);
    }
};

// HTML 태그 이스케이프 유틸리티 함수
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

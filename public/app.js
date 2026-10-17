const slotList = document.querySelector('#slot-list');
const currentDate = document.querySelector('#current-date');
const feedingDetail = document.querySelector('#feeding-detail');
const loadError = document.querySelector('#load-error');
const bookingForm = document.querySelector('#booking-form');
const bookingChoice = document.querySelector('#booking-choice');
const employeeNameInput = document.querySelector('#employee-name');
const bookingMessage = document.querySelector('#booking-message');
const cancelBookingButton = document.querySelector('#cancel-booking');
const feedingForm = document.querySelector('#feeding-form');
const feedingNameInput = document.querySelector('#feeding-name');
const feedingMessage = document.querySelector('#feeding-message');
let selectedSlotTime = null;

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function renderSlots(slots) {
  slotList.replaceChildren();
  for (const slot of slots) {
    const isBooked = Boolean(slot.bookedBy);
    const item = document.createElement('li');
    item.className = `slot-card ${isBooked ? 'is-booked' : 'is-available'}`;

    const time = document.createElement('span');
    time.className = 'slot-time';
    time.textContent = slot.time;

    const state = document.createElement('span');
    state.className = 'slot-state';
    const dot = document.createElement('span');
    dot.className = 'state-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = isBooked ? slot.bookedBy : 'Свободно';
    state.append(dot, label);
    item.append(time, state);

    if (!isBooked) {
      const button = document.createElement('button');
      button.className = 'booking-trigger';
      button.type = 'button';
      button.dataset.slotTime = slot.time;
      button.textContent = 'Записаться';
      button.setAttribute('aria-label', `Записаться на прогулку в ${slot.time}`);
      item.append(button);
    }

    slotList.append(item);
  }
  slotList.setAttribute('aria-busy', 'false');
}

function setBookingMessage(message, isError = false) {
  bookingMessage.textContent = message;
  bookingMessage.classList.toggle('is-error', isError);
  bookingMessage.hidden = !message;
}

slotList.addEventListener('click', (event) => {
  const button = event.target.closest('.booking-trigger');
  if (!button) return;

  selectedSlotTime = button.dataset.slotTime;
  bookingChoice.textContent = `Выбран слот ${selectedSlotTime}`;
  bookingForm.hidden = false;
  setBookingMessage('');
  employeeNameInput.focus();
});

cancelBookingButton.addEventListener('click', () => {
  bookingForm.hidden = true;
  selectedSlotTime = null;
  setBookingMessage('');
});

bookingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const employeeName = employeeNameInput.value.trim();
  if (!selectedSlotTime || !employeeName) {
    setBookingMessage('Выберите свободный слот и введите ФИО.', true);
    return;
  }

  const submitButton = bookingForm.querySelector('.submit-button');
  submitButton.disabled = true;
  setBookingMessage('Сохраняем запись…');
  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotTime: selectedSlotTime, employeeName }),
    });
    const result = await response.json();
    if (response.status === 409) {
      bookingForm.hidden = true;
      selectedSlotTime = null;
      await loadToday();
      setBookingMessage(result.error, true);
      return;
    }
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить запись.');

    bookingForm.hidden = true;
    selectedSlotTime = null;
    employeeNameInput.value = '';
    await loadToday();
    setBookingMessage(`Вы записаны на ${result.slot.time}.`);
  } catch (error) {
    setBookingMessage(error.message || 'Не удалось сохранить запись. Попробуйте ещё раз.', true);
  } finally {
    submitButton.disabled = false;
  }
});

feedingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const employeeName = feedingNameInput.value.trim();
  if (!employeeName) {
    feedingMessage.textContent = 'Введите ФИО без лишних пробелов.';
    feedingMessage.classList.add('is-error');
    feedingMessage.hidden = false;
    return;
  }

  const submitButton = feedingForm.querySelector('.feeding-submit');
  submitButton.disabled = true;
  feedingMessage.textContent = 'Сохраняем отметку…';
  feedingMessage.classList.remove('is-error');
  feedingMessage.hidden = false;
  try {
    const response = await fetch('/api/feedings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeName }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить отметку.');

    feedingNameInput.value = '';
    await loadToday();
    feedingMessage.textContent = 'Отметка сохранена.';
    feedingMessage.classList.remove('is-error');
  } catch (error) {
    feedingMessage.textContent = error.message || 'Не удалось сохранить отметку. Попробуйте ещё раз.';
    feedingMessage.classList.add('is-error');
  } finally {
    feedingMessage.hidden = false;
    submitButton.disabled = false;
  }
});

async function loadToday() {
  try {
    const response = await fetch('/api/today');
    if (!response.ok) throw new Error('Не удалось получить данные');
    const data = await response.json();
    currentDate.textContent = formatDate(data.date);
    renderSlots(data.slots);
    feedingDetail.textContent = data.lastFeeding
      ? `${data.lastFeeding.employeeName} · ${formatDateTime(data.lastFeeding.fedAt)}`
      : 'Пока кормление не отмечено';
  } catch {
    loadError.hidden = false;
    currentDate.textContent = 'Дата недоступна';
    slotList.setAttribute('aria-busy', 'false');
    feedingDetail.textContent = 'Данные недоступны';
  }
}

loadToday();

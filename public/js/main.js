// Global client-side behaviour, loaded on every page by the layouts.
(() => {
  const body = document.body;

  // Off-canvas sidebar on small screens
  const setSidebar = open => {
    body.classList.toggle('sidebar-open', open);
    document
      .querySelectorAll('[data-sidebar-open]')
      .forEach(button => button.setAttribute('aria-expanded', String(open)));
  };
  document.addEventListener('click', event => {
    if (event.target.closest('[data-sidebar-open]')) setSidebar(true);
    if (event.target.closest('[data-sidebar-close]')) setSidebar(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setSidebar(false);
  });

  // ---------- Forms ----------

  // Show/hide password + Caps Lock hint
  document.querySelectorAll('[data-password-field]').forEach(field => bindPassword(field));
  function bindPassword(field) {
    const input = field.querySelector('input');
    const toggle = field.querySelector('[data-toggle-password]');
    const caps = field.querySelector('[data-caps-warning]');
    toggle?.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      toggle.querySelector('[data-icon-show]').hidden = show;
      toggle.querySelector('[data-icon-hide]').hidden = !show;
      input.focus();
    });
    const updateCaps = event => {
      if (caps && event.getModifierState) caps.hidden = !event.getModifierState('CapsLock');
    };
    input.addEventListener('keyup', updateCaps);
    input.addEventListener('keydown', updateCaps);
    input.addEventListener('blur', () => caps && (caps.hidden = true));
  }

  // Password strength meter
  document.addEventListener('input', event => {
    const input = event.target.closest?.('[data-strength-input]');
    if (!input) return;
    const meter = input.closest('[data-password-field]').querySelector('[data-strength]');
    const label = meter.querySelector('[data-strength-label]');
    label.dataset.hint ??= label.textContent;
    const words = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const value = input.value;
    let score = 0;
    if (value.length >= 8) score++;
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (value.length >= 12 || /[^A-Za-z0-9]/.test(value)) score++;
    if (!value) score = 0;
    meter.dataset.score = String(score);
    label.textContent = value ? words[score] || 'Weak' : label.dataset.hint;
  });

  // One-time code boxes: auto-advance, backspace, paste a full code
  document.querySelectorAll('[data-otp]').forEach(group => {
    const inputs = [...group.querySelectorAll('input')];
    const fill = (digits, start = 0) => {
      digits.split('').forEach((digit, offset) => {
        if (inputs[start + offset]) inputs[start + offset].value = digit;
      });
      const next = inputs.find(input => !input.value) || inputs[inputs.length - 1];
      next.focus();
      // Submit automatically only when nothing else in the form is still empty
      const form = group.closest('form');
      if (inputs.every(input => input.value) && form?.checkValidity()) form.requestSubmit?.();
    };
    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '');
        input.value = '';
        if (digits) fill(digits, index);
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Backspace' && !input.value && index > 0) {
          inputs[index - 1].value = '';
          inputs[index - 1].focus();
          event.preventDefault();
        }
        if (event.key === 'ArrowLeft' && index > 0) inputs[index - 1].focus();
        if (event.key === 'ArrowRight' && index < inputs.length - 1) inputs[index + 1].focus();
      });
      input.addEventListener('paste', event => {
        const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, inputs.length);
        if (!digits) return;
        event.preventDefault();
        inputs.forEach(item => (item.value = ''));
        fill(digits);
      });
    });
  });

  // Resend countdown ("Resend code in 0:42")
  document.querySelectorAll('[data-countdown]').forEach(button => {
    const label = button.textContent;
    let remaining = Number(button.dataset.countdown) || 0;
    const tick = () => {
      if (remaining <= 0) {
        button.disabled = false;
        button.textContent = label;
        return;
      }
      button.disabled = true;
      button.textContent = `${label} in 0:${String(remaining).padStart(2, '0')}`;
      remaining -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  });

  // Disable submit buttons while a full-page form posts, so it is sent once
  document.querySelectorAll('[data-loading-form]').forEach(form => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('[type="submit"]');
      if (!button || button.getAttribute('aria-busy') === 'true') return;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${button.dataset.loadingText || button.textContent}`;
      setTimeout(() => (button.disabled = true));
    });
  });

  // Toasts close on click or after a few seconds
  document.querySelectorAll('[data-toast]').forEach(toastEl => {
    const close = () => {
      toastEl.classList.add('is-leaving');
      setTimeout(() => toastEl.remove(), 220);
    };
    toastEl.querySelector('[data-toast-close]')?.addEventListener('click', close);
    setTimeout(close, 5000);
  });

  // File dropzones: show the chosen file, a thumbnail and catch oversize files
  const formatBytes = bytes =>
    bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const bindDropzone = zone => {
    if (zone.dataset.bound) return;
    zone.dataset.bound = '1';
    const input = zone.querySelector('input[type="file"]');
    const empty = zone.querySelector('.dropzone-empty');
    const chosen = zone.querySelector('.dropzone-file');
    const thumb = zone.querySelector('[data-thumb]');
    const fileIcon = thumb.innerHTML;
    const field = zone.closest('.field');
    const maxBytes = Number(zone.dataset.maxBytes) || Infinity;

    const showError = message => {
      field.classList.toggle('has-error', Boolean(message));
      let error = field.querySelector('.field-error');
      if (!message) return error?.remove();
      if (!error) {
        error = document.createElement('p');
        error.className = 'field-error';
        zone.after(error);
      }
      error.textContent = message;
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > maxBytes) {
        input.value = '';
        showError(`This file is ${formatBytes(file.size)}. Choose one under ${formatBytes(maxBytes)}.`);
        return;
      }
      showError('');
      zone.querySelector('[data-file-name]').textContent = file.name;
      zone.querySelector('[data-file-size]').textContent = formatBytes(file.size);
      thumb.innerHTML = fileIcon;
      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        thumb.replaceChildren(img);
      }
      if (empty) empty.hidden = true;
      if (chosen) chosen.hidden = false;
    });

    ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, () => zone.classList.add('is-dragging')));
    ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, () => zone.classList.remove('is-dragging')));
  };
  document.querySelectorAll('[data-dropzone]').forEach(bindDropzone);

  // ---------- Portal UI kit ----------

  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const toastStack = document.querySelector('[data-toast-stack]');

  const toast = (message, type = 'success') => {
    if (!toastStack) return;
    const item = document.createElement('div');
    item.className = `toast toast-${type}`;
    item.setAttribute('role', 'status');
    item.innerHTML = `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
      type === 'error'
        ? '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'
        : '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'
    }</svg><p></p>`;
    item.querySelector('p').textContent = message;
    toastStack.append(item);
    setTimeout(() => {
      item.classList.add('is-leaving');
      setTimeout(() => item.remove(), 220);
    }, 3800);
  };

  const post = (url, payload) =>
    fetch(url, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrf, 'X-Requested-With': 'fetch', Accept: 'application/json, text/html' },
      body: payload,
    });

  // Fragments that reload themselves from [data-table-url]
  const tableState = new WeakMap();
  const loadTable = async (table, params) => {
    const state = { ...(tableState.get(table) || {}), ...params };
    tableState.set(table, state);
    const query = new URLSearchParams(
      Object.entries(state).filter(([, value]) => value !== undefined && value !== ''),
    ).toString();
    if (!table.dataset.tableUrl) return;
    table.classList.add('is-loading');
    try {
      const response = await fetch(`${table.dataset.tableUrl}${query ? `?${query}` : ''}`, {
        headers: { Accept: 'text/html', 'X-Requested-With': 'fetch' },
      });
      if (!response.ok) throw new Error(String(response.status));
      table.innerHTML = await response.text();
      table.dispatchEvent(new CustomEvent('fragment:loaded', { bubbles: true }));
      if (table.dataset.history === 'off') return;
      const pageUrl = new URL(location.href);
      pageUrl.search = new URLSearchParams(
        Object.entries(state).filter(([key, value]) => value && !(key === 'page' && value === '1')),
      ).toString();
      history.replaceState(null, '', pageUrl);
    } catch {
      toast('Could not load the list. Please try again.', 'error');
    } finally {
      table.classList.remove('is-loading');
    }
  };

  document.querySelectorAll('[data-table-url]').forEach(table => {
    if (table.dataset.history !== 'off')
      tableState.set(table, Object.fromEntries(new URL(location.href).searchParams.entries()));
    table.addEventListener('click', event => {
      const link = event.target.closest('[data-table-page]');
      if (!link) return;
      event.preventDefault();
      loadTable(table, { page: new URL(link.href, location.href).searchParams.get('page') });
    });
  });

  document.querySelectorAll('[data-table-search]').forEach(input => {
    const table = document.querySelector(input.dataset.tableSearch);
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadTable(table, { q: input.value.trim(), page: '1' }), 250);
    });
  });

  document.querySelectorAll('[data-table-filter]').forEach(select => {
    const table = document.querySelector(select.dataset.tableFilter);
    select.addEventListener('change', () => loadTable(table, { [select.name]: select.value, page: '1' }));
  });

  // Underline tabs that filter a fragment table (e.g. merchant status)
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-table-tab]');
    if (!tab) return;
    event.preventDefault();
    const table = document.querySelector(tab.dataset.tableTab);
    tab.closest('.tabs')?.querySelectorAll('.tab').forEach(item => {
      item.classList.toggle('is-active', item === tab);
      item.setAttribute('aria-selected', String(item === tab));
    });
    if (table) loadTable(table, { [tab.dataset.param]: tab.dataset.value, page: '1' });
  });

  // Reload one or more fragment containers, e.g. "#roles-list, #role-detail"
  const refresh = selectors => {
    (selectors || '')
      .split(',')
      .map(selector => selector.trim())
      .filter(selector => selector && selector !== '#undefined' && selector !== '#')
      .forEach(selector => {
        const table = document.querySelector(selector);
        if (table) loadTable(table, {});
      });
  };

  // Server responses can ask the page to react (e.g. { event: 'role:select', id })
  const emit = result => {
    if (result?.event) document.dispatchEvent(new CustomEvent(result.event, { detail: result }));
  };

  const follow = result => {
    if (result.redirect) setTimeout(() => (location.href = result.redirect), 450);
    else if (result.reload) setTimeout(() => location.reload(), 650);
  };

  // Slide-over drawer with forms loaded as fragments
  const drawer = document.querySelector('[data-drawer]');
  const drawerBody = drawer?.querySelector('[data-drawer-body]');
  const drawerPanel = drawer?.querySelector('.drawer-panel');
  let lastFocus = null;

  const closeDrawer = () => {
    if (!drawer?.classList.contains('is-open')) return;
    // Panels that change the page behind them (e.g. recovery codes) reload it
    if (drawerBody.querySelector('[data-reload-on-close]')) setTimeout(() => location.reload(), 350);
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setTimeout(() => (drawerBody.innerHTML = ''), 320);
    lastFocus?.focus();
  };

  const bindDrawerForm = () => {
    drawerBody.querySelectorAll('[data-password-field]').forEach(bindPassword);
    const form = drawerBody.querySelector('[data-ajax-form]');
    if (!form) return;
    form.querySelectorAll('[data-dropzone]').forEach(bindDropzone);
    if (form.matches('[data-perm-picker]')) bindPermissionPicker(form);
    (form.querySelector('[autofocus]') || form.querySelector('input:not([type="hidden"]), select'))?.focus();

    // Live flag preview on the country form
    const code = form.querySelector('input[name="code"]');
    const img = form.querySelector('[data-flag-img]');
    const placeholder = form.querySelector('[data-flag-placeholder]');
    code?.addEventListener('input', () => {
      code.value = code.value.toUpperCase();
      if (!img) return;
      const value = code.value.trim();
      const src = /^[a-z]{2}$/i.test(value) ? `https://flagcdn.com/w80/${value.toLowerCase()}.png` : '';
      img.hidden = !src;
      placeholder.hidden = Boolean(src);
      if (src && img.getAttribute('src') !== src) img.src = src;
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      submitAjax(form, event.submitter, true);
    });
  };

  // Submits a [data-ajax-form] with fetch. 422 answers carry the form again
  // with errors; success answers are JSON ({ ok, message, redirect, reload, event }).
  async function submitAjax(form, submitter, inDrawer) {
    const button = submitter || form.querySelector('[type="submit"]');
    if (!button || button.disabled) return;
    const label = button.innerHTML;
    const buttons = [...form.querySelectorAll('[type="submit"]')];
    buttons.forEach(item => (item.disabled = true));
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${button.dataset.loadingText || 'Saving…'}`;
    const restore = () => {
      buttons.forEach(item => (item.disabled = false));
      button.innerHTML = label;
    };
    try {
      const data = new FormData(form);
      if (submitter?.name) data.set(submitter.name, submitter.value);
      // Forms with file inputs go as multipart; others as urlencoded
      const payload = form.querySelector('input[type="file"]') ? data : new URLSearchParams(data);
      const response = await post(form.action, payload);
      if (response.status === 422) {
        const html = await response.text();
        if (inDrawer) {
          drawerBody.innerHTML = html;
          bindDrawerForm();
          drawerBody.querySelector('[aria-invalid="true"], .alert-error')?.scrollIntoView({ block: 'nearest' });
        } else {
          const target = (form.dataset.inlineForm && document.querySelector(form.dataset.inlineForm)) || form.parentElement;
          target.innerHTML = html;
          target.querySelectorAll('[data-dropzone]').forEach(bindDropzone);
          target.querySelectorAll('[data-password-field]').forEach(bindPassword);
        }
        return;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Something went wrong');
      if (inDrawer) closeDrawer();
      else restore();
      toast(result.message);
      refresh(form.dataset.refresh);
      emit(result);
      follow(result);
    } catch (error) {
      toast(error.message || 'Something went wrong', 'error');
      restore();
    }
  }

  // Page-level ajax forms (outside the drawer), e.g. KYC review, settings
  document.addEventListener('submit', event => {
    const form = event.target.closest?.('form[data-ajax-form]');
    if (!form || form.closest('[data-drawer]')) return;
    event.preventDefault();
    submitAjax(form, event.submitter, false);
  });

  const openDrawer = async url => {
    if (!drawer) return;
    lastFocus = document.activeElement;
    drawerBody.classList.add('is-loading');
    drawerBody.innerHTML = '<div class="skeleton skeleton-lg"></div><div class="skeleton"></div><div class="skeleton skeleton-lg"></div><div class="skeleton"></div>';
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    drawerPanel.focus();
    try {
      const response = await fetch(url, { headers: { Accept: 'text/html', 'X-Requested-With': 'fetch' } });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'Could not open the form. Please try again.');
      }
      drawerBody.classList.remove('is-loading');
      drawerBody.innerHTML = await response.text();
      bindDrawerForm();
      // Parts that load themselves, e.g. a card's live details
      drawerBody.querySelectorAll('[data-autoload]').forEach(part => loadTable(part, {}));
    } catch (error) {
      closeDrawer();
      toast(error.message, 'error');
    }
  };

  document.addEventListener('click', event => {
    const opener = event.target.closest('[data-drawer-url]');
    if (opener && !event.target.closest('a[href]:not([data-drawer-url]), input, label')) openDrawer(opener.dataset.drawerUrl);
    if (event.target.closest('[data-drawer-close]')) closeDrawer();
  });

  drawer?.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDrawer();
    if (event.key !== 'Tab') return;
    // Keep focus inside the drawer while it is open
    const focusable = [...drawerPanel.querySelectorAll('button, a[href], input, select, textarea')].filter(
      el => !el.disabled && el.offsetParent,
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  });

  // Switches that save at once: optimistic, reverted if saving fails
  document.addEventListener('change', async event => {
    const input = event.target.closest('[data-toggle-url]');
    if (!input) return;
    input.disabled = true;
    try {
      const response = await post(input.dataset.toggleUrl);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message);
      input.checked = result.active;
      toast(result.message);
      refresh(input.dataset.refresh);
    } catch (error) {
      input.checked = !input.checked;
      toast(error.message || 'Could not update. Please try again.', 'error');
    } finally {
      input.disabled = false;
    }
  });

  // Confirmation using the native <dialog>, with an optional note
  const dialog = document.querySelector('[data-confirm-dialog]');
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-confirm-url]');
    if (!trigger || !dialog) return;
    dialog.querySelector('[data-confirm-title]').textContent = trigger.dataset.confirmTitle || 'Are you sure?';
    dialog.querySelector('[data-confirm-text]').textContent = trigger.dataset.confirmText || '';
    const note = dialog.querySelector('[data-confirm-note]');
    note.hidden = !('confirmNote' in trigger.dataset);
    note.querySelector('textarea').value = '';
    const confirmButton = dialog.querySelector('[data-confirm-button]');
    confirmButton.textContent = trigger.dataset.confirmLabel || 'Delete';
    confirmButton.className = `btn ${trigger.dataset.confirmTone === 'primary' ? 'btn-primary' : 'btn-danger'}`;
    dialog.returnValue = '';
    dialog.showModal();
    dialog.addEventListener(
      'close',
      async () => {
        if (dialog.returnValue !== 'confirm') return;
        try {
          const params = new URLSearchParams(trigger.dataset.confirmBody ? JSON.parse(trigger.dataset.confirmBody) : {});
          if (!note.hidden) params.set('note', note.querySelector('textarea').value);
          const response = await post(trigger.dataset.confirmUrl, params);
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.message);
          toast(result.message);
          refresh(trigger.dataset.refresh || `#${trigger.closest('[data-table-url]')?.id}`);
          emit(result);
          follow(result);
        } catch (error) {
          toast(error.message || 'Something went wrong. Please try again.', 'error');
        }
      },
      { once: true },
    );
  });

  // One-click actions that POST and refresh (e.g. remove a permission)
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-post-url]');
    if (!button) return;
    button.disabled = true;
    button.closest('.perm-row')?.classList.add('is-leaving');
    try {
      const response = await post(button.dataset.postUrl);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message);
      toast(result.message);
      refresh(button.dataset.refresh);
      emit(result);
      follow(result);
    } catch (error) {
      button.disabled = false;
      button.closest('.perm-row')?.classList.remove('is-leaving');
      toast(error.message || 'Something went wrong', 'error');
    }
  });

  // "Add permissions" drawer: filter, select all per group, live count
  function bindPermissionPicker(form) {
    const submit = form.querySelector('[data-pick-submit]');
    const count = form.querySelector('[data-pick-count]');
    const boxes = () => [...form.querySelectorAll('input[name="permissionIds"]')];
    const update = () => {
      const picked = boxes().filter(box => box.checked).length;
      if (count) count.textContent = String(picked);
      if (submit) {
        submit.disabled = picked === 0;
        submit.textContent = picked ? `Add ${picked} permission${picked === 1 ? '' : 's'}` : 'Add permissions';
      }
      form.querySelectorAll('[data-pick-group]').forEach(group => {
        const visible = [...group.querySelectorAll('[data-pick-row]')].filter(row => !row.hidden);
        const all = visible.length > 0 && visible.every(row => row.querySelector('input').checked);
        const toggle = group.querySelector('[data-pick-all]');
        if (toggle) toggle.textContent = all ? 'Clear all' : 'Select all';
      });
    };
    form.addEventListener('change', update);
    form.querySelectorAll('[data-pick-all]').forEach(button =>
      button.addEventListener('click', () => {
        const rows = [...button.closest('[data-pick-group]').querySelectorAll('[data-pick-row]')].filter(row => !row.hidden);
        const all = rows.every(row => row.querySelector('input').checked);
        rows.forEach(row => (row.querySelector('input').checked = !all));
        update();
      }),
    );
    const filter = form.querySelector('[data-perm-filter]');
    filter?.addEventListener('input', () => {
      const term = filter.value.trim().toLowerCase();
      let any = false;
      form.querySelectorAll('[data-pick-group]').forEach(group => {
        let shown = 0;
        group.querySelectorAll('[data-pick-row]').forEach(row => {
          row.hidden = Boolean(term) && !row.dataset.name.toLowerCase().includes(term);
          if (!row.hidden) shown += 1;
        });
        group.hidden = shown === 0;
        any = any || shown > 0;
      });
      const empty = form.querySelector('[data-perm-no-match]');
      if (empty) empty.hidden = any;
      update();
    });
    update();
  }

  // Roles two-pane page
  const rolesPage = document.querySelector('[data-roles]');
  if (rolesPage) {
    const base = rolesPage.dataset.base;
    const list = rolesPage.querySelector('#roles-list');
    const detail = rolesPage.querySelector('#role-detail');
    const search = rolesPage.querySelector('[data-role-search]');

    const highlight = id => {
      list.querySelectorAll('.role-item').forEach(item => {
        const on = item.dataset.roleId === String(id);
        item.classList.toggle('is-selected', on);
        if (on) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      });
    };
    const filterList = () => {
      const term = (search?.value || '').trim().toLowerCase();
      let shown = 0;
      list.querySelectorAll('.role-item').forEach(item => {
        const hide = Boolean(term) && !item.dataset.roleName.toLowerCase().includes(term);
        item.parentElement.hidden = hide;
        if (!hide) shown += 1;
      });
      const empty = list.querySelector('[data-role-no-match]');
      if (empty) empty.hidden = shown > 0 || !term;
    };
    const select = (id, { reloadList = false } = {}) => {
      if (!id) return;
      detail.dataset.tableUrl = `${base}/${id}`;
      highlight(id);
      loadTable(detail, {});
      if (reloadList) loadTable(list, { selected: String(id) });
      const url = new URL(location.href);
      url.searchParams.set('role', id);
      history.replaceState(null, '', url);
    };

    list.addEventListener('click', event => {
      const item = event.target.closest('.role-item');
      if (item) select(item.dataset.roleId);
    });
    list.addEventListener('fragment:loaded', filterList);
    search?.addEventListener('input', filterList);

    document.addEventListener('role:select', event => select(event.detail.id, { reloadList: true }));
    document.addEventListener('role:deleted', async () => {
      // The delete button already refreshed the list; wait for it, then pick
      // the first remaining role
      await new Promise(resolve => setTimeout(resolve, 250));
      tableState.set(list, {});
      await loadTable(list, {});
      const first = list.querySelector('.role-item');
      if (first) select(first.dataset.roleId);
      else detail.innerHTML = '';
    });
  }

  // Member drawer: live count of selected roles
  document.addEventListener('change', event => {
    const box = event.target.closest?.('[data-role-check]');
    if (!box) return;
    const form = box.closest('[data-team-form]');
    const count = form?.querySelector('[data-role-count]');
    if (count) count.textContent = String(form.querySelectorAll('[data-role-check]:checked').length);
  });

  // A save can open the next drawer, e.g. a new credential's one-time secret
  document.addEventListener('drawer:open', event => setTimeout(() => openDrawer(event.detail.url), 380));

  // Copy buttons
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      toast('Copied');
    } catch {
      toast('Could not copy. Select the text and copy it instead.', 'error');
    }
  });

  // Show or hide a secret
  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-secret-toggle]');
    if (!toggle) return;
    const box = toggle.closest('[data-secret]');
    const value = box.querySelector('[data-secret-value]');
    const show = value.hidden;
    value.hidden = !show;
    box.querySelector('[data-secret-mask]').hidden = show;
    toggle.lastChild.textContent = show ? ' Hide' : ' Show';
  });

  // Rows that navigate (e.g. merchant list → workspace)
  document.addEventListener('click', event => {
    const row = event.target.closest('tr[data-href]');
    if (!row || event.target.closest('a, button, input, label')) return;
    location.href = row.dataset.href;
  });

  // KYC review: Reject reveals the comment; any choice replaces "Pending"
  document.addEventListener('change', event => {
    const radio = event.target.closest?.('[data-review-item] input[type="radio"]');
    if (!radio) return;
    const item = radio.closest('[data-review-item]');
    item.querySelector('[data-pending-default]')?.remove();
    const comment = item.querySelector('[data-review-comment]');
    if (comment) {
      comment.hidden = radio.value !== 'Rejected';
      if (!comment.hidden) comment.querySelector('input')?.focus();
    }
  });

  // Clear a field's inline error as soon as the user edits it
  document.addEventListener('input', event => {
    const field = event.target.closest?.('.field.has-error');
    if (!field) return;
    field.classList.remove('has-error');
    field.querySelector('.field-error')?.remove();
    field.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
  });

  // Developer guide: code sample tabs
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-code-tab]');
    if (!tab) return;
    const box = tab.closest('[data-code-tabs]');
    box.querySelectorAll('[data-code-tab]').forEach(item => item.classList.toggle('is-active', item === tab));
    box.querySelectorAll('[data-code-panel]').forEach(panel => (panel.hidden = panel.dataset.codePanel !== tab.dataset.codeTab));
  });

  // Developer guide: highlight the section in view
  const toc = document.querySelector('[data-docs-toc]');
  if (toc && 'IntersectionObserver' in window) {
    const links = [...toc.querySelectorAll('a')];
    const observer = new IntersectionObserver(
      entries => {
        entries
          .filter(entry => entry.isIntersecting)
          .forEach(entry => links.forEach(link => link.classList.toggle('is-active', link.hash === `#${entry.target.id}`)));
      },
      { rootMargin: '-90px 0px -65% 0px' },
    );
    links.forEach(link => {
      const section = document.querySelector(link.hash);
      if (section) observer.observe(section);
    });
  }

  // Card drawer: full number, expiry and CVV behind a one-time code. The
  // card spins a full turn and the details swap in while its back is showing.
  const revealTimers = new WeakMap();
  const revealCardFor = el => el.closest('.drawer-content')?.querySelector('[data-card-reveal]');
  const revealPanelFor = card => card.closest('.drawer-content')?.querySelector('[data-card-reveal-form]');

  const spinCard = (card, swap) => {
    card.classList.remove('is-spinning');
    void card.offsetWidth;
    card.classList.add('is-spinning');
    setTimeout(swap, 550);
    setTimeout(() => card.classList.remove('is-spinning'), 1150);
  };

  const setCardFace = (card, details) => {
    const number = card.querySelector('[data-card-number]');
    number.textContent = details ? details.number : number.dataset.masked;
    card.querySelector('[data-card-expiry]').textContent = details ? details.expiry : '••/••';
    card.querySelector('[data-card-cvv]').textContent = details ? details.cvv : '•••';
    card.classList.toggle('is-revealed', Boolean(details));
    card.querySelector('[data-eye-open]').hidden = Boolean(details);
    card.querySelector('[data-eye-closed]').hidden = !details;
    card.querySelector('[data-card-reveal-open]').setAttribute('aria-label', details ? 'Hide card details' : 'View full card details');
    const timer = card.querySelector('[data-card-timer]');
    timer.hidden = !details;
    if (!details) return;
    const bar = timer.firstElementChild;
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${details.showFor}s linear`;
    bar.style.transform = 'scaleX(0)';
  };

  const hideCardDetails = card => {
    clearTimeout(revealTimers.get(card));
    revealTimers.delete(card);
    if (card.classList.contains('is-revealed')) spinCard(card, () => setCardFace(card, null));
  };

  const showCardDetails = (card, details) => {
    spinCard(card, () => setCardFace(card, details));
    revealTimers.set(card, setTimeout(() => hideCardDetails(card), details.showFor * 1000 + 550));
  };

  const revealError = (panel, message) => {
    const error = panel.querySelector('[data-reveal-error]');
    error.textContent = message || '';
    error.hidden = !message;
  };

  const sendRevealCode = async (card, panel) => {
    const message = panel.querySelector('[data-reveal-message]');
    revealError(panel, '');
    message.textContent = 'Sending a code…';
    try {
      const response = await post(card.dataset.cardReveal, new URLSearchParams());
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not send a code. Please try again.');
      message.textContent = `${result.message}. It expires in ${Math.round(result.expiresIn / 60)} minutes.`;
      panel.querySelector('input[name="code"]').focus();
    } catch (error) {
      message.textContent = '';
      revealError(panel, error.message);
    }
  };

  document.addEventListener('click', event => {
    const eye = event.target.closest('[data-card-reveal-open]');
    if (eye) {
      const card = eye.closest('[data-card-reveal]');
      if (card.classList.contains('is-revealed')) return hideCardDetails(card);
      const panel = revealPanelFor(card);
      if (!panel) return;
      if (!panel.hidden) return panel.querySelector('input[name="code"]').focus();
      panel.reset();
      panel.hidden = false;
      sendRevealCode(card, panel);
      return;
    }
    const resend = event.target.closest('[data-reveal-resend]');
    if (resend) {
      const panel = resend.closest('[data-card-reveal-form]');
      sendRevealCode(revealCardFor(panel), panel);
      return;
    }
    const cancel = event.target.closest('[data-reveal-cancel]');
    if (cancel) cancel.closest('[data-card-reveal-form]').hidden = true;
  });

  // Six digits typed or pasted: check straight away
  document.addEventListener('input', event => {
    const input = event.target.closest?.('[data-card-reveal-form] input[name="code"]');
    if (!input) return;
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) input.form.requestSubmit?.();
  });

  document.addEventListener('submit', async event => {
    const panel = event.target.closest?.('[data-card-reveal-form]');
    if (!panel) return;
    event.preventDefault();
    const card = revealCardFor(panel);
    const input = panel.querySelector('input[name="code"]');
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) {
      revealError(panel, 'Enter the 6-digit code');
      return input.focus();
    }
    const button = panel.querySelector('[type="submit"]');
    if (button.disabled) return;
    const label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${button.dataset.loadingText || 'Checking…'}`;
    revealError(panel, '');
    try {
      const response = await post(`${card.dataset.cardReveal}/verify`, new URLSearchParams({ code }));
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not check the code. Please try again.');
      panel.hidden = true;
      panel.reset();
      showCardDetails(card, result);
    } catch (error) {
      revealError(panel, error.message);
      input.select();
    } finally {
      button.disabled = false;
      button.innerHTML = label;
    }
  });

  // Forms that run once when the page opens, e.g. pulling stale transactions
  document.querySelectorAll('form[data-auto-submit]').forEach(form => form.requestSubmit?.());

  // Idle sign-out: after N minutes without activity a dialog counts down and
  // then signs the user out. Activity is shared between tabs (localStorage),
  // so working in one tab keeps the others signed in, and signing out in one
  // signs out all of them.
  const idleDialog = document.querySelector('[data-idle-dialog]');
  if (idleDialog) {
    const idleMs = Number(idleDialog.dataset.idleMinutes || 5) * 60_000;
    const countdownMs = Number(idleDialog.dataset.idleCountdown || 60) * 1000;
    const activityKey = 'saveapp:last-activity';
    const signedOutKey = 'saveapp:signed-out';
    const token = idleDialog.querySelector('input[name="_csrf"]').value;
    const ring = idleDialog.querySelector('[data-idle-ring]');
    const ringLength = 2 * Math.PI * 52;
    const count = idleDialog.querySelector('[data-idle-seconds]');
    const countText = idleDialog.querySelector('[data-idle-seconds-text]');
    const store = {
      get: key => {
        try {
          return Number(localStorage.getItem(key)) || 0;
        } catch {
          return 0;
        }
      },
      set: (key, value) => {
        try {
          localStorage.setItem(key, String(value));
        } catch {
          // Private mode: this tab still works on its own
        }
      },
    };
    let lastActivity = Date.now();
    let lastPing = Date.now();
    let warning = false;
    let leaving = false;

    const markActive = () => {
      lastActivity = Date.now();
      store.set(activityKey, lastActivity);
    };
    markActive();

    // Rolling sessions: a request now and then keeps the server session alive
    const keepAlive = () => {
      lastPing = Date.now();
      fetch('/auth/keep-alive', { method: 'POST', headers: { 'X-CSRF-Token': token, 'X-Requested-With': 'fetch' } })
        .then(response => {
          if (response.status === 401) location.href = '/auth/login?idle=1';
        })
        .catch(() => {});
    };

    const signOut = () => {
      if (leaving) return;
      leaving = true;
      store.set(signedOutKey, Date.now());
      idleDialog.querySelector('[data-idle-logout]').submit();
    };

    const closeWarning = () => {
      warning = false;
      idleDialog.classList.remove('is-urgent');
      if (idleDialog.open) idleDialog.close();
    };

    const stay = () => {
      markActive();
      keepAlive();
      closeWarning();
    };

    const check = () => {
      if (leaving) return;
      const idleFor = Date.now() - Math.max(lastActivity, store.get(activityKey));
      if (idleFor < idleMs) {
        if (warning) closeWarning();
        return;
      }
      const leftMs = idleMs + countdownMs - idleFor;
      if (leftMs <= 0) return signOut();
      const seconds = Math.ceil(leftMs / 1000);
      count.textContent = String(seconds);
      countText.textContent = `${seconds} second${seconds === 1 ? '' : 's'}`;
      ring.style.strokeDasharray = String(ringLength);
      ring.style.strokeDashoffset = String(ringLength * (1 - leftMs / countdownMs));
      idleDialog.classList.toggle('is-urgent', seconds <= 10);
      if (!warning) {
        warning = true;
        // Another dialog (e.g. a confirm) may be open; the countdown goes on top
        if (!idleDialog.open) idleDialog.showModal();
        idleDialog.querySelector('[data-idle-stay]').focus();
      }
    };

    // Any input counts as activity, until the dialog is up: then only "Stay"
    const onActivity = () => {
      if (warning || leaving) return;
      const now = Date.now();
      if (now - lastActivity < 5000) return;
      markActive();
      if (now - lastPing > 60_000) keepAlive();
    };
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'].forEach(type =>
      window.addEventListener(type, onActivity, { passive: true, capture: true }),
    );

    idleDialog.querySelector('[data-idle-stay]').addEventListener('click', stay);
    idleDialog.querySelector('[data-idle-signout]').addEventListener('click', signOut);
    // Escape means "I'm here"
    idleDialog.addEventListener('cancel', event => {
      event.preventDefault();
      stay();
    });

    window.addEventListener('storage', event => {
      if (event.key === signedOutKey && !leaving) {
        leaving = true;
        location.href = '/auth/login?idle=1';
      }
      if (event.key === activityKey) check();
    });
    // Background tabs run timers late; check again as soon as one is shown
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 1000);
  }

  // Images that fail to load are swapped for their text fallback (initials)
  document.addEventListener(
    'error',
    event => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
      const span = document.createElement('span');
      span.className = img.dataset.fallbackClass || img.className;
      span.textContent = img.dataset.fallback;
      img.replaceWith(span);
    },
    true,
  );
})();

// Users: the owner adds staff accounts, edits their username, screens and status, and resets their password.
// The permissions list shows every screen in the sidebar, grouped as the sidebar is. Only the owner can open this page
// (the route names the owner-only 'users' screen), and the service checks the owner again on every write.
import * as ui from '../core/ui.js';
import { esc, icon } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { AuthError } from '../core/auth.js';
import { OWNER_SCREEN, SCREENS } from '../core/access.js';
import * as users from '../services/users.js';

export const route = '/users';
export const title = 'nav.users';

const GROUPS = ['daily', 'medicines', 'parties', 'accounts', 'admin'];
let $host = null;
let rows = [];

const screenLabel = (screen) => t(screen.label);

function sectionsText(user) {
  if (user.role === 'owner') return t('access.allSections');
  if (!user.sections.length) return t('access.noSectionsYet');
  const labels = SCREENS.filter((screen) => user.sections.includes(screen.key)).map(screenLabel);
  return labels.join(' · ');
}

function cardHtml(user) {
  const isOwner = user.role === 'owner';
  const role = `<span class="badge">${esc(t(isOwner ? 'access.owner' : 'access.staff'))}</span>`;
  const status = user.active
    ? `<span class="badge badge--ok">${esc(t('access.active'))}</span>`
    : `<span class="badge badge--danger">${esc(t('access.inactive'))}</span>`;
  const actions = isOwner
    ? `<p class="muted small">${esc(t('users.ownerNote'))}</p>`
    : `<div class="row">
         <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(user.id)}">${icon('settings')} ${esc(t('users.edit'))}</button>
         <button type="button" class="btn btn-danger btn-sm" data-delete="${esc(user.id)}">${esc(t('users.delete'))}</button>
       </div>`;
  return `
    <article class="card user-card" aria-label="${esc(user.username)}">
      <div class="user-head"><strong class="user-name">${esc(user.username)}</strong> ${role} ${status}</div>
      <p class="user-scope small">${esc(sectionsText(user))}</p>
      ${actions}
    </article>`;
}

/** One checkbox per sidebar screen, grouped as the sidebar is. The owner-only screen is shown but cannot be ticked. */
function screenBoxes(selected) {
  const box = (screen) => `<label class="user-check"><input type="checkbox" name="section" value="${esc(screen.key)}"${selected.includes(screen.key) ? ' checked' : ''}> <span>${esc(screenLabel(screen))}</span></label>`;
  const ownerBox = `<label class="user-check is-locked"><input type="checkbox" disabled checked> <span>${esc(screenLabel(OWNER_SCREEN))}</span> <span class="muted small">${esc(t('access.ownerOnly'))}</span></label>`;
  return `<fieldset class="user-sections">
    <legend>${esc(t('users.sections'))}</legend>
    ${GROUPS.map((group) => {
      const screens = SCREENS.filter((screen) => screen.group === group);
      const extra = group === 'admin' ? ownerBox : '';
      if (!screens.length && !extra) return '';
      return `<div class="user-group">
        <h4 class="user-group-title">${esc(t(`nav.group.${group}`))}</h4>
        <div class="user-group-checks">${screens.map(box).join('')}${extra}</div>
      </div>`;
    }).join('')}
  </fieldset>`;
}

function formHtml(user) {
  const isNew = !user;
  return `
    <form class="user-form" novalidate>
      <div class="field">
        <label for="uf-name">${esc(t('users.username'))}</label>
        <input id="uf-name" type="text" autocomplete="off" value="${esc(user?.username ?? '')}">
      </div>
      <div class="field">
        <label for="uf-pass">${esc(t(isNew ? 'users.password' : 'users.newPassword'))}</label>
        <input id="uf-pass" type="password" autocomplete="new-password">
      </div>
      <div class="field">
        <label for="uf-confirm">${esc(t('settings.confirmPassword'))}</label>
        <input id="uf-confirm" type="password" autocomplete="new-password">
      </div>
      ${screenBoxes(user?.sections ?? [])}
      ${isNew ? '' : `<label class="user-check"><input type="checkbox" id="uf-active"${user.active ? ' checked' : ''}> <span>${esc(t('access.active'))}</span></label>`}
      <p class="form-error" role="alert" hidden></p>
    </form>`;
}

function readForm(form) {
  const $form = $(form);
  return {
    username: $form.find('#uf-name').val(),
    password: $form.find('#uf-pass').val(),
    confirm: $form.find('#uf-confirm').val(),
    sections: $form.find('input[name="section"]:checked').map((_, el) => el.value).get(),
    active: $form.find('#uf-active').prop('checked'),
  };
}

/** Saves the form. A new account is created; an existing one gets its username, screens and status and, when a password is typed, a new one. */
async function save(user, body, modal) {
  const $error = body.find('.form-error');
  const values = readForm(body[0]);
  try {
    if (!user) {
      await users.createUser(values);
      ui.toast(t('users.created'), { type: 'success' });
    } else {
      await users.updateUser(user.id, { username: values.username, sections: values.sections, active: values.active });
      if (values.password) await users.resetPassword(user.id, values);
      ui.toast(t('users.saved'), { type: 'success' });
    }
    modal.close();
    await paint();
  } catch (err) {
    $error.text(err instanceof AuthError ? t(`auth.err.${err.code}`, err.vars) : t('errors.generic')).prop('hidden', false);
  }
}

function openForm(user) {
  const body = $(formHtml(user));
  let busy = false;
  const modal = ui.openModal({
    title: user ? t('users.editTitle', { name: user.username }) : t('users.addTitle'),
    body,
    actions: [
      { label: t('btn.cancel'), variant: 'ghost' },
      {
        label: t('users.save'),
        variant: 'primary',
        onClick: () => {
          // The dialog stays open until the save succeeds; a second tap while saving is ignored.
          if (!busy) {
            busy = true;
            save(user, body, modal).finally(() => {
              busy = false;
            });
          }
          return false;
        },
      },
    ],
  });
}

async function removeUser(user) {
  const ok = await ui.confirmDialog({
    title: t('users.deleteTitle'),
    message: t('users.deleteMessage', { name: user.username }),
    confirmLabel: t('users.delete'),
    danger: true,
  });
  if (!ok) return;
  try {
    await users.deleteUser(user.id);
    ui.toast(t('users.deleted'), { type: 'success' });
    await paint();
  } catch (err) {
    ui.toast(err instanceof AuthError ? t(`auth.err.${err.code}`, err.vars) : t('errors.generic'), { type: 'error' });
  }
}

async function paint() {
  if (!$host) return;
  try {
    rows = await users.listUsers();
  } catch (err) {
    $host.html(`<section class="card empty-state" role="alert"><p>${esc(err instanceof AuthError ? t(`auth.err.${err.code}`, err.vars) : t('errors.generic'))}</p></section>`);
    return;
  }
  $host.html(`
    <div class="page-head">
      <div><h2>${esc(t('users.title'))}</h2><p class="muted small">${esc(t('users.intro'))}</p></div>
      <div class="row"><button type="button" class="btn btn-primary" data-add>${icon('customers')} ${esc(t('users.add'))}</button></div>
    </div>
    <div class="user-list">
      ${rows.map(cardHtml).join('')}
    </div>
    ${rows.length > 1 ? '' : `<p class="muted small">${esc(t('users.empty'))}</p>`}`);
}

export async function render($root) {
  // Work inside a child element: handlers bound to #view itself would pile up across visits.
  $root.html('<div class="users-root"></div>');
  $host = $root.children('.users-root');
  $host.on('click', '[data-add]', () => openForm(null));
  $host.on('click', '[data-edit]', (event) => openForm(rows.find((u) => u.id === event.currentTarget.getAttribute('data-edit'))));
  $host.on('click', '[data-delete]', (event) => removeUser(rows.find((u) => u.id === event.currentTarget.getAttribute('data-delete'))));
  await paint();
}

export function destroy() {
  $host = null;
  rows = [];
}

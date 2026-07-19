/**
 * Unit specs for the migrated React in-place assign lightbox
 * (`SelectUserLightbox`), covering QA finding KB-3.
 *
 * The QA visual-fidelity gate flagged that the React Kanban card avatar
 * quick-assign NAVIGATED to the AngularJS `/us/:ref` detail page instead of
 * opening the in-place `tg-lb-select-user` lightbox the AngularJS board used
 * (`changeUsAssignedUsers` -> `lightboxFactory.create('tg-lb-select-user', ...)`).
 * This component is the faithful reproduction of that lightbox. These specs lock
 * in the corrected behavior so it cannot silently regress:
 *
 *   - renders `.lightbox.lightbox-select-user` with the title, a search input,
 *     one `.user-list-item` per member, and the `.lb-select-user-confirm` action;
 *   - already-assigned members render `.is-active` with a `.remove-selected`
 *     control; not-assigned members do not;
 *   - project roles render as `.user-list-item` rows carrying `span.role` +
 *     `span.users`; a role with no members is not rendered; in `single` mode no
 *     role rows appear at all;
 *   - clicking a not-assigned user selects it; clicking `.remove-selected`
 *     removes it; clicking a role row unions its members into the selection;
 *   - the search box filters rows (accent-insensitive) and swaps the confirm
 *     action for a `.lb-select-user-link-back` that clears the search;
 *   - the `.lb-select-user-confirm` button commits the current selection via
 *     `onConfirm`; the `.close` control cancels via `onCancel` (never `onConfirm`);
 *   - `single` mode confirms immediately on a user click; Escape cancels.
 */

import { render, fireEvent } from '@testing-library/react';
import SelectUserLightbox, {
  type SelectUserMember,
  type SelectUserRole,
} from '../SelectUserLightbox';

/* ------------------------------------------------------------------ *
 * Fixtures -- disk-accurate shapes from the live backend (project 1):
 *   members carry id / full_name_display / role / is_active / gravatar_id.
 * ------------------------------------------------------------------ */
const MEMBERS: SelectUserMember[] = [
  { id: 5, full_name_display: 'Alice', role: 1, is_active: true, photo: null, gravatar_id: 'g5' },
  { id: 6, full_name_display: 'Bob', role: 2, is_active: true, photo: null, gravatar_id: 'g6' },
  { id: 7, full_name_display: 'Carol', role: 1, is_active: true, photo: null, gravatar_id: 'g7' },
];

const ROLES: SelectUserRole[] = [
  { id: 1, name: 'UX' },
  { id: 2, name: 'Design' },
  { id: 3, name: 'Empty Role' }, // no members -> row must not render
];

/** Identity i18n (return the key's English source for the handful used). */
const I18N: Record<string, string> = {
  'COMMON.ASSIGNED_USERS.ADD': 'Select assigned user',
  'LIGHTBOX.SELECT_USER.SEARCH': 'Search for users',
  'LIGHTBOX.SELECT_USER.ROLE': 'Role',
  'LIGHTBOX.SELECT_USER.REMOVE': 'Remove user',
  'COMMON.ADD': 'Add',
  'COMMON.BACK': 'Back',
  'COMMON.CLOSE': 'Close',
};
const t = (key: string): string => I18N[key] ?? key;

interface Overrides {
  activeUsers?: SelectUserMember[];
  roles?: SelectUserRole[];
  initialUserIds?: number[];
  single?: boolean;
  onConfirm?: (ids: number[]) => void;
  onCancel?: () => void;
}

function renderLb(over: Overrides = {}) {
  const onConfirm = over.onConfirm ?? jest.fn();
  const onCancel = over.onCancel ?? jest.fn();
  const utils = render(
    <SelectUserLightbox
      lbTitle={t('COMMON.ASSIGNED_USERS.ADD')}
      activeUsers={over.activeUsers ?? MEMBERS}
      roles={over.roles ?? ROLES}
      initialUserIds={over.initialUserIds ?? []}
      single={over.single}
      t={t}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

/** All user rows (rows without a `span.role`) with their displayed name. */
function userRows(container: HTMLElement): { el: HTMLElement; name: string; active: boolean }[] {
  return Array.from(container.querySelectorAll('.user-list-item'))
    .filter((el) => el.querySelector('.user-list-name') && !el.querySelector('span.role'))
    .map((el) => ({
      el: el as HTMLElement,
      name: (el.querySelector('.user-list-name') as HTMLElement).textContent ?? '',
      active: el.classList.contains('is-active'),
    }));
}

describe('SelectUserLightbox (KB-3 in-place assign)', () => {
  it('renders the lightbox shell, title, search input, member rows and the confirm action', () => {
    const { container } = renderLb();

    const lb = container.querySelector('.lightbox.lightbox-select-user');
    expect(lb).toBeInTheDocument();
    expect(container.querySelector('h2.title')?.textContent).toBe('Select assigned user');
    const input = container.querySelector('.lb-select-user-form input[type="text"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.placeholder).toBe('Search for users');
    // one row per member (3) + one role row per NON-empty role (UX, Design).
    expect(userRows(container).map((r) => r.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
    expect(container.querySelector('.lb-select-user-confirm')?.textContent).toBe('Add');
  });

  it('marks already-assigned members .is-active with a .remove-selected, others not', () => {
    const { container } = renderLb({ initialUserIds: [5] });

    const rows = userRows(container);
    const alice = rows.find((r) => r.name === 'Alice');
    const bob = rows.find((r) => r.name === 'Bob');
    expect(alice?.active).toBe(true);
    expect(bob?.active).toBe(false);
    // The active row exposes a remove control; the inactive row does not.
    expect(alice?.el.querySelector('.remove-selected')).toBeInTheDocument();
    expect(bob?.el.querySelector('.remove-selected')).not.toBeInTheDocument();
  });

  it('renders role rows with span.role + span.users, and omits roles with no members', () => {
    const { container } = renderLb();

    const roleRows = Array.from(container.querySelectorAll('.user-list-item')).filter((el) =>
      el.querySelector('span.role'),
    );
    const roleNames = roleRows.map((el) => (el.querySelector('span.role') as HTMLElement).textContent);
    // "Role: UX" and "Role: Design" render; "Role: Empty Role" (0 members) does
    // not. The whole non-selected collection is `_.sortBy(..., 'name')` (directive
    // parity), so "Role: Design" precedes "Role: UX".
    expect(roleNames).toEqual(['Role: Design', 'Role: UX']);
    // The UX role's userNames lists its members (Alice, Carol).
    const ux = roleRows.find((el) => (el.querySelector('span.role') as HTMLElement).textContent === 'Role: UX');
    expect((ux?.querySelector('span.users') as HTMLElement).textContent).toBe('(Alice, Carol)');
  });

  it('selecting a not-assigned user then confirming reports it via onConfirm', () => {
    const { container, onConfirm } = renderLb();

    const bob = userRows(container).find((r) => r.name === 'Bob') as { el: HTMLElement };
    fireEvent.click(bob.el);
    fireEvent.click(container.querySelector('.lb-select-user-confirm') as HTMLElement);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith([6]);
  });

  it('removing an already-assigned user via .remove-selected drops it from the confirmed set', () => {
    const { container, onConfirm } = renderLb({ initialUserIds: [5, 6] });

    const alice = userRows(container).find((r) => r.name === 'Alice') as { el: HTMLElement };
    fireEvent.click(alice.el.querySelector('.remove-selected') as HTMLElement);
    fireEvent.click(container.querySelector('.lb-select-user-confirm') as HTMLElement);

    expect(onConfirm).toHaveBeenCalledWith([6]);
  });

  it('clicking a role row unions all of its members into the selection', () => {
    const { container, onConfirm } = renderLb();

    // "Role: UX" -> members Alice(5) + Carol(7).
    const ux = Array.from(container.querySelectorAll('.user-list-item')).find(
      (el) => (el.querySelector('span.role') as HTMLElement | null)?.textContent === 'Role: UX',
    ) as HTMLElement;
    fireEvent.click(ux);
    fireEvent.click(container.querySelector('.lb-select-user-confirm') as HTMLElement);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm as jest.Mock).mock.calls[0][0].slice().sort()).toEqual([5, 7]);
  });

  it('filtering by text narrows the rows, swaps in a Back link, and Back clears the search', () => {
    const { container } = renderLb();
    const input = container.querySelector('.lb-select-user-form input[type="text"]') as HTMLInputElement;

    // accent-insensitive, case-insensitive substring match.
    fireEvent.change(input, { target: { value: 'ali' } });
    expect(userRows(container).map((r) => r.name)).toEqual(['Alice']);
    // the confirm action is replaced by the Back link while searching.
    expect(container.querySelector('.lb-select-user-confirm')).not.toBeInTheDocument();
    const back = container.querySelector('.lb-select-user-link-back') as HTMLElement;
    expect(back).toBeInTheDocument();

    fireEvent.click(back);
    expect((container.querySelector('.lb-select-user-form input[type="text"]') as HTMLInputElement).value).toBe('');
    // all rows are back and the confirm action returns.
    expect(userRows(container).map((r) => r.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
    expect(container.querySelector('.lb-select-user-confirm')).toBeInTheDocument();
  });

  it('the .close control cancels via onCancel and never confirms', () => {
    const { container, onConfirm, onCancel } = renderLb();

    fireEvent.click(container.querySelector('.close') as HTMLElement);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('single mode hides role rows and confirms immediately on a user click', () => {
    const { container, onConfirm } = renderLb({ single: true });

    // no role rows in single mode.
    expect(container.querySelectorAll('span.role').length).toBe(0);

    const carol = userRows(container).find((r) => r.name === 'Carol') as { el: HTMLElement };
    fireEvent.click(carol.el);

    // a single-select click confirms right away with just that id.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith([7]);
  });

  it('Escape cancels the lightbox', () => {
    const { onCancel } = renderLb();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clicking an already-assigned user row is a no-op (does not re-add or duplicate)', () => {
    const { container, onConfirm } = renderLb({ initialUserIds: [5] });

    const alice = userRows(container).find((r) => r.name === 'Alice') as { el: HTMLElement };
    // Click the row body (not the remove control) -> already selected -> no change.
    fireEvent.click(alice.el);
    fireEvent.click(container.querySelector('.lb-select-user-confirm') as HTMLElement);

    expect(onConfirm).toHaveBeenCalledWith([5]);
  });
});

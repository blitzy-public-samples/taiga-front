/**
 * Unit specs for the migrated React create/edit user-story lightbox
 * (`CreateEditUsLightbox`), covering QA findings K-CREATE and K-EDIT.
 *
 * The QA visual-fidelity gate flagged that the React Kanban board rendered only
 * a bare subject stub for "+ New user story" (K-CREATE) and NAVIGATED away to the
 * AngularJS `/us/:ref` detail page for a card's Edit action (K-EDIT), instead of
 * reproducing the full AngularJS generic create/edit lightbox in place. This
 * component is the fix. These specs lock in the corrected behavior so it cannot
 * silently regress:
 *
 *   - CREATE renders "New user story" + a LOCATION radio group + a "Create"
 *     button; every role's estimation defaults to the "?" point and the total is
 *     "?" (an unestimated new story).
 *   - EDIT renders the SAME modal titled "Edit user story", prefilled from the
 *     story, with NO LOCATION section and a "Save" button; the estimation rows
 *     and total reflect the story's existing points.
 *   - The subject is required (an empty submit is a no-op close).
 *   - The status dropdown, LOCATION radios, per-role points popover, tag add/
 *     remove, self-assign, and the team/client/block toggles all feed the
 *     normalized `onSubmit` payload (which KanbanApp translates into the frozen
 *     create/edit REST call).
 *
 * The two pure estimation helpers (`calculateTotalPoints`, `calculateRoleRows`)
 * reproduce `EstimationService` (estimation.coffee:169/181) and are unit-tested
 * directly.
 */

import { render, fireEvent, act, within } from '@testing-library/react';
import CreateEditUsLightbox, {
  calculateTotalPoints,
  calculateRoleRows,
  type LightboxStatus,
  type LightboxRole,
  type LightboxPoint,
  type LightboxUser,
  type EditUsModel,
  type UsFormValues,
} from '../CreateEditUsLightbox';

/* ------------------------------------------------------------------ *
 * Fixtures -- disk-accurate shapes from the live backend (project 1):
 *   roles: UX/Design/Front/Back are computable, ordered 10..40.
 *   points: "?"(value null) .. numeric; "?" is the CREATE default.
 * ------------------------------------------------------------------ */
const STATUSES: LightboxStatus[] = [
  { id: 1, name: 'New', color: '#70728F' },
  { id: 2, name: 'Done', color: '#A9AABC' },
];

const ROLES: LightboxRole[] = [
  { id: 1, name: 'UX', order: 10 },
  { id: 2, name: 'Design', order: 20 },
  { id: 3, name: 'Front', order: 30 },
  { id: 4, name: 'Back', order: 40 },
];

const POINTS: LightboxPoint[] = [
  { id: 1, name: '?', value: null, order: 1 },
  { id: 2, name: '0', value: 0, order: 2 },
  { id: 3, name: '1/2', value: 0.5, order: 3 },
  { id: 4, name: '1', value: 1, order: 4 },
  { id: 5, name: '2', value: 2, order: 5 },
  { id: 6, name: '3', value: 3, order: 6 },
];

const POINTS_BY_ID: Record<number, LightboxPoint> = POINTS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<number, LightboxPoint>,
);

const USERS_BY_ID: Record<number, LightboxUser> = {
  9: { id: 9, full_name_display: 'Ada Lovelace', photo: null },
};

/* A minimal English translator: the handful of keys the specs assert on, with a
 * key-passthrough fallback (mirrors the real KanbanApp I18N subset). */
const STRINGS: Record<string, string> = {
  'LIGHTBOX.CREATE_EDIT.NEW_US': 'New user story',
  'LIGHTBOX.CREATE_EDIT.EDIT_US': 'Edit user story',
  'LIGHTBOX.CREATE_EDIT.LOCATION': 'Location',
  'LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM': 'at the bottom',
  'LIGHTBOX.CREATE_EDIT.CREATE_TOP': 'on top',
  'LIGHTBOX.CREATE_EDIT.US_PLACEHOLDER_DESCRIPTION': 'Please add descriptive text',
  'COMMON.CREATE': 'Create',
  'COMMON.SAVE': 'Save',
  'COMMON.CLOSE': 'Close',
  'COMMON.DELETE': 'Delete',
  'COMMON.OR': 'or',
  'COMMON.FIELDS.SUBJECT': 'Subject',
  'COMMON.FIELDS.POINTS': 'Points',
  'COMMON.FIELDS.DUE_DATE': 'Due date',
  'COMMON.TAGS.ADD': 'Add tag',
  'COMMON.TAGS.PLACEHOLDER': 'Enter tag',
  'COMMON.ASSIGNED_TO.ASSIGN': 'Assign',
  'COMMON.ASSIGNED_TO.SELF': 'Assign to me',
  'COMMON.ASSIGNED_TO.DELETE_ASSIGNMENT': 'Delete assignment',
  'COMMON.BLOCKED_NOTE': 'Why is this blocked?',
  'COMMON.TEAM_REQUIREMENT': 'Team requirement',
  'COMMON.CLIENT_REQUIREMENT': 'Client requirement',
  'COMMON.BLOCK_TITLE': 'Block',
  'US.TOTAL_POINTS': 'total points',
  'ATTACHMENT.SECTION_NAME': 'Attachments',
  'ATTACHMENT.ADD': 'Add new attachment',
  'ATTACHMENT.DROP': 'Drop attachments here!',
};
const t = (key: string): string => STRINGS[key] ?? key;

/* Shared props; each test overrides `mode` / `us` / spies as needed. */
function baseProps(
  overrides: Partial<React.ComponentProps<typeof CreateEditUsLightbox>> = {},
): React.ComponentProps<typeof CreateEditUsLightbox> {
  return {
    mode: 'create',
    us: null,
    statuses: STATUSES,
    roles: ROLES,
    points: POINTS,
    usersById: USERS_BY_ID,
    currentUserId: 9,
    initialStatusId: 1,
    t,
    onClose: jest.fn(),
    onSubmit: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

/* An edited story: all four roles estimated at point id 4 ("1"), so the
 * breakdown reads "1" per role and the total is 4 -- matching the baseline
 * `kanban-edit-us.png` (UX 1 / Design 1 / Front 1 / Back 1 / total points 4). */
const EDIT_MODEL: EditUsModel = {
  id: 11,
  subject: 'test subject-1',
  description: 'test description-3',
  status: 2,
  points: { '1': 4, '2': 4, '3': 4, '4': 4 },
  tags: [['tag-2', null]],
  assigned_users: [9],
  total_points: 4,
  is_blocked: false,
  blocked_note: '',
  team_requirement: false,
  client_requirement: false,
};

/* ================================================================== *
 * Pure helpers
 * ================================================================== */
describe('CreateEditUsLightbox - estimation helpers', () => {
  it('calculateTotalPoints: returns "?" when the estimation map is empty', () => {
    expect(calculateTotalPoints({}, POINTS_BY_ID)).toBe('?');
  });

  it('calculateTotalPoints: returns "?" when every role is the "?" point (null value)', () => {
    expect(calculateTotalPoints({ '1': 1, '2': 1, '3': 1, '4': 1 }, POINTS_BY_ID)).toBe('?');
  });

  it('calculateTotalPoints: sums the numeric point values, ignoring "?" (null)', () => {
    // UX=1(id4) + Design=2(id5) + Front="?"(id1,null) + Back=3(id6) => 6
    expect(calculateTotalPoints({ '1': 4, '2': 5, '3': 1, '4': 6 }, POINTS_BY_ID)).toBe('6');
  });

  it('calculateTotalPoints: treats a 0-valued point as a real 0 (not "?")', () => {
    // 0(id2) + 1/2(id3) => 0.5
    expect(calculateTotalPoints({ '1': 2, '2': 3 }, POINTS_BY_ID)).toBe('0.5');
  });

  it('calculateRoleRows: resolves each role to its selected point name in role order', () => {
    const rows = calculateRoleRows(ROLES, { '1': 4, '2': 5, '3': 1, '4': 6 }, POINTS_BY_ID);
    expect(rows).toEqual([
      { id: 1, name: 'UX', points: '1' },
      { id: 2, name: 'Design', points: '2' },
      { id: 3, name: 'Front', points: '?' },
      { id: 4, name: 'Back', points: '3' },
    ]);
  });

  it('calculateRoleRows: falls back to "?" for a role with no (or unknown) point', () => {
    const rows = calculateRoleRows(ROLES, {}, POINTS_BY_ID);
    expect(rows.map((r) => r.points)).toEqual(['?', '?', '?', '?']);
  });
});

/* ================================================================== *
 * CREATE mode rendering (K-CREATE)
 * ================================================================== */
describe('CreateEditUsLightbox - CREATE mode', () => {
  it('renders the full "New user story" lightbox shell with the create affordances', () => {
    const { container } = render(<CreateEditUsLightbox {...baseProps()} />);

    const lightbox = container.querySelector('.lightbox.lightbox-generic-form.lightbox-create-edit');
    expect(lightbox).toBeInTheDocument();
    expect(lightbox).toHaveClass('open');
    // Title + submit copy are the CREATE variants.
    expect(container.querySelector('h2.title')?.textContent).toBe('New user story');
    expect(container.querySelector('#submitButton')?.textContent).toBe('Create');
    // A real, empty, required subject field (not a stub).
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    expect(subject).toBeInTheDocument();
    expect(subject.value).toBe('');
    expect(subject.maxLength).toBe(500);
    // The close affordance (tg-lightbox-close) is present.
    expect(container.querySelector('a.close')).toBeInTheDocument();
  });

  it('renders the LOCATION radio group defaulting to "at the bottom" (create only)', () => {
    const { container } = render(<CreateEditUsLightbox {...baseProps()} />);

    const location = container.querySelector('.creation-position');
    expect(location).toBeInTheDocument();
    const bottom = container.querySelector('input[name="us_position"][value="bottom"]') as HTMLInputElement;
    const top = container.querySelector('input[name="us_position"][value="top"]') as HTMLInputElement;
    expect(bottom.checked).toBe(true);
    expect(top.checked).toBe(false);
  });

  it('defaults every estimation role to "?" and the total to "?" for a new story', () => {
    const { container } = render(<CreateEditUsLightbox {...baseProps()} />);

    const roleRows = container.querySelectorAll('.points-per-role .ticket-role-points');
    // 4 computable roles + 1 total row.
    expect(roleRows).toHaveLength(5);
    // Every role points cell reads "?".
    ROLES.forEach((role) => {
      const row = container.querySelector(`.ticket-role-points[data-role-id="${role.id}"]`);
      expect(within(row as HTMLElement).getByText(role.name)).toBeInTheDocument();
      expect((row as HTMLElement).querySelector('.points')?.textContent).toBe('?');
    });
    // Total row.
    const totalRow = roleRows[roleRows.length - 1];
    expect(within(totalRow as HTMLElement).getByText('total points')).toBeInTheDocument();
    expect((totalRow as HTMLElement).querySelector('.points')?.textContent).toBe('?');
  });

  it('shows the initial status ("New") in the status dropdown', () => {
    const { container } = render(<CreateEditUsLightbox {...baseProps()} />);
    expect(container.querySelector('.status-dropdown .status-text')?.textContent).toBe('New');
  });

  it('submits the trimmed subject with position "bottom" and the default statusId', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: '  New story  ' },
    });
    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = (onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues;
    expect(values.subject).toBe('New story');
    expect(values.position).toBe('bottom');
    expect(values.statusId).toBe(1);
  });

  it('an empty subject is a no-op: onClose fires and onSubmit does NOT', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const onClose = jest.fn();
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit, onClose })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: '   ' },
    });
    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('choosing the "on top" LOCATION radio submits position "top"', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'Story' },
    });
    fireEvent.click(container.querySelector('input[name="us_position"][value="top"]') as HTMLElement);
    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });

    expect(((onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues).position).toBe('top');
  });

  it('changing the status via the dropdown submits the chosen statusId', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'Story' },
    });
    // Open the dropdown and pick "Done" (id 2).
    fireEvent.click(container.querySelector('.status-dropdown') as HTMLElement);
    const statusPop = container.querySelector('ul.pop-status') as HTMLElement;
    // The open popover reproduces the jQuery plugin's fadeIn + addClass('active')
    // (popovers.coffee): it MUST carry BOTH the inline `display:block` override
    // (the SCSS `popover()` mixin defaults to `display:none`) AND the `active`
    // class, or it renders hidden. Backlog's E2E asserts `ul.pop-status` visible.
    expect(statusPop).toHaveClass('active');
    expect(statusPop.style.display).toBe('block');
    const doneOption = within(statusPop).getByText('Done');
    fireEvent.click(doneOption);
    expect(container.querySelector('.status-dropdown .status-text')?.textContent).toBe('Done');

    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    expect(((onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues).statusId).toBe(2);
  });

  it('picking a per-role point updates the total and the submitted estimation map', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'Story' },
    });
    // Open the UX (role 1) points popover and choose point id 5 ("2", value 2).
    const uxRow = container.querySelector('.ticket-role-points[data-role-id="1"]') as HTMLElement;
    fireEvent.click(uxRow.querySelector('.role') as HTMLElement);
    // DOM-parity contract: the open estimation popover reproduces the AngularJS
    // `$.fn.popover().open()` output `ul.popover.pop-points-open.active`
    // (`app/coffee/modules/common/popovers.coffee:174`). The E2E `setRole` helper
    // and the SCSS both key off `.popover.active`, so the open state MUST carry it.
    const openPopover = uxRow.querySelector('.popover.pop-points-open') as HTMLElement;
    expect(openPopover).not.toBeNull();
    expect(openPopover.classList.contains('active')).toBe(true);
    const option = uxRow.querySelector('a[data-point-id="5"][data-role-id="1"]') as HTMLElement;
    fireEvent.click(option);

    // UX cell now shows "2"; total becomes 2 (others still "?").
    expect(uxRow.querySelector('.points')?.textContent).toBe('2');
    const totalRow = container.querySelectorAll('.points-per-role .ticket-role-points')[4];
    expect(totalRow.querySelector('.points')?.textContent).toBe('2');

    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    expect(((onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues).points['1']).toBe(5);
  });

  it('adding a tag (open input -> type -> Enter) submits it in the tags payload', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'Story' },
    });
    // DOM parity with the shared `tg-tag-line-common` widget: reveal via the
    // `.e2e-show-tag-input` button, type into `input.tag-input.e2e-add-tag-input`,
    // commit via Enter (the directive's keydown handler).
    fireEvent.click(container.querySelector('.e2e-show-tag-input') as HTMLElement);
    const tagInput = container.querySelector('input.tag-input') as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: 'urgent' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    expect(within(container.querySelector('.tags-container') as HTMLElement).getByText('urgent')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    expect(((onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues).tags).toEqual([['urgent', null]]);
  });

  it('self-assign adds the current user and submits them in assigned_users', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'Story' },
    });
    fireEvent.click(container.querySelector('a.self-assign') as HTMLElement);
    // The avatar now shows the assigned user.
    expect(container.querySelector('.user-list .user-list-item')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    expect(((onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues).assignedUsers).toEqual([9]);
  });

  it('toggling team + client requirement submits both booleans as true', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'Story' },
    });
    const team = container.querySelector('.btn-icon.team-requirement') as HTMLElement;
    const client = container.querySelector('.btn-icon.client-requirement') as HTMLElement;
    fireEvent.click(team);
    fireEvent.click(client);
    expect(team).toHaveClass('active');
    expect(client).toHaveClass('active');

    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    const values = (onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues;
    expect(values.teamRequirement).toBe(true);
    expect(values.clientRequirement).toBe(true);
  });

  it('blocking reveals the blocked-note field and submits the note + is_blocked', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onSubmit })} />);

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'Story' },
    });
    // No note field until blocked.
    expect(container.querySelector('fieldset.blocked-note')).not.toBeInTheDocument();
    fireEvent.click(container.querySelector('.btn-icon.is-blocked') as HTMLElement);
    const note = container.querySelector('fieldset.blocked-note input[name="blocked_note"]') as HTMLInputElement;
    expect(note).toBeInTheDocument();
    fireEvent.change(note, { target: { value: 'waiting on API' } });

    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    const values = (onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues;
    expect(values.isBlocked).toBe(true);
    expect(values.blockedNote).toBe('waiting on API');
  });

  it('clicking the ✕ close affordance calls onClose without submitting', () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(<CreateEditUsLightbox {...baseProps({ onClose, onSubmit })} />);

    fireEvent.click(container.querySelector('a.close') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reproduces the tg-attachments-simple widget: empty state, then client-side add/count/delete', () => {
    const { container } = render(<CreateEditUsLightbox {...baseProps()} />);

    // The shared attachments host + its section are reproduced (parity with
    // `attachments-simple.jade` embedded at `lb-create-edit.jade:92`).
    const widget = container.querySelector('tg-attachments-simple');
    expect(widget).toBeInTheDocument();
    const section = widget?.querySelector('section.attachments.attachment-simple');
    expect(section).toBeInTheDocument();

    // A brand-new story starts empty: count 0, empty-state prompt visible, and a
    // real hidden `#add-attach` file input the "+" button proxies to.
    expect(section?.querySelector('.attachments-num')?.textContent).toBe('0');
    expect(section?.querySelector('.attachments-empty')).toBeInTheDocument();
    expect(section?.querySelectorAll('.single-attachment')).toHaveLength(0);
    const input = section?.querySelector('#add-attach[type="file"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.multiple).toBe(true);

    // Selecting two files appends two `.single-attachment` rows, updates the
    // count, and hides the empty-state prompt (client-side `addAttachments`).
    const fileA = new File(['a'], 'diagram.png', { type: 'image/png' });
    const fileB = new File(['bb'], 'notes.txt', { type: 'text/plain' });
    act(() => {
      fireEvent.change(input, { target: { files: [fileA, fileB] } });
    });
    expect(section?.querySelectorAll('.single-attachment')).toHaveLength(2);
    expect(section?.querySelector('.attachments-num')?.textContent).toBe('2');
    expect(section?.querySelector('.attachments-empty')).not.toBeInTheDocument();
    // Each row shows its file name (name label) + a delete control.
    const names = Array.from(section?.querySelectorAll('.single-attachment .attachment-name span') ?? []).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['diagram.png', 'notes.txt']);
    expect(section?.querySelectorAll('.single-attachment .attachment-delete')).toHaveLength(2);

    // Deleting the first row drops exactly that entry (client-side
    // `deleteAttachment`), leaving the second.
    act(() => {
      fireEvent.click(section?.querySelector('.single-attachment .attachment-delete') as HTMLElement);
    });
    expect(section?.querySelectorAll('.single-attachment')).toHaveLength(1);
    expect(section?.querySelector('.attachments-num')?.textContent).toBe('1');
    expect(section?.querySelector('.single-attachment .attachment-name span')?.textContent).toBe('notes.txt');
  });
});

/* ================================================================== *
 * EDIT mode rendering (K-EDIT)
 * ================================================================== */
describe('CreateEditUsLightbox - EDIT mode', () => {
  it('renders the "Edit user story" variant prefilled, with NO LOCATION and a "Save" button', () => {
    const { container } = render(
      <CreateEditUsLightbox {...baseProps({ mode: 'edit', us: EDIT_MODEL })} />,
    );

    expect(container.querySelector('h2.title')?.textContent).toBe('Edit user story');
    expect(container.querySelector('#submitButton')?.textContent).toBe('Save');
    // Subject + description are prefilled from the story.
    expect((container.querySelector('input[name="subject"]') as HTMLInputElement).value).toBe(
      'test subject-1',
    );
    expect((container.querySelector('textarea[name="description"]') as HTMLTextAreaElement).value).toBe(
      'test description-3',
    );
    // EDIT omits the LOCATION section entirely.
    expect(container.querySelector('.creation-position')).not.toBeInTheDocument();
    // The status shows the story's status ("Done", id 2).
    expect(container.querySelector('.status-dropdown .status-text')?.textContent).toBe('Done');
  });

  it('reflects the story estimation: each role "1" and total "4"', () => {
    const { container } = render(
      <CreateEditUsLightbox {...baseProps({ mode: 'edit', us: EDIT_MODEL })} />,
    );

    ROLES.forEach((role) => {
      const row = container.querySelector(`.ticket-role-points[data-role-id="${role.id}"]`);
      expect((row as HTMLElement).querySelector('.points')?.textContent).toBe('1');
    });
    const rows = container.querySelectorAll('.points-per-role .ticket-role-points');
    expect(rows[rows.length - 1].querySelector('.points')?.textContent).toBe('4');
  });

  it('prefills the existing tag and the assigned user', () => {
    const { container } = render(
      <CreateEditUsLightbox {...baseProps({ mode: 'edit', us: EDIT_MODEL })} />,
    );
    expect(within(container.querySelector('.tags-container') as HTMLElement).getByText('tag-2')).toBeInTheDocument();
    expect(container.querySelector('.user-list .user-list-item')).toBeInTheDocument();
  });

  it('shows the blocked-note prefilled when the edited story is blocked', () => {
    const blocked: EditUsModel = { ...EDIT_MODEL, is_blocked: true, blocked_note: 'blocked reason' };
    const { container } = render(
      <CreateEditUsLightbox {...baseProps({ mode: 'edit', us: blocked })} />,
    );
    const note = container.querySelector('fieldset.blocked-note input[name="blocked_note"]') as HTMLInputElement;
    expect(note).toBeInTheDocument();
    expect(note.value).toBe('blocked reason');
    expect(container.querySelector('.btn-icon.is-blocked')).toHaveClass('item-unblock');
  });

  it('submits the edited subject unchanged-in-shape (EDIT never carries a position mutation intent)', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(
      <CreateEditUsLightbox {...baseProps({ mode: 'edit', us: EDIT_MODEL, onSubmit })} />,
    );

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
      target: { value: 'renamed subject' },
    });
    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });

    const values = (onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues;
    expect(values.subject).toBe('renamed subject');
    expect(values.statusId).toBe(2);
    // The estimation map round-trips the story's existing points.
    expect(values.points).toEqual({ '1': 4, '2': 4, '3': 4, '4': 4 });
  });

  it('removing the prefilled tag drops it from the submitted payload', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(
      <CreateEditUsLightbox {...baseProps({ mode: 'edit', us: EDIT_MODEL, onSubmit })} />,
    );

    // DOM parity: each chip is `.tag-wrapper > tg-tag > .tag`, and the delete
    // affordance is the `tg-svg.icon-close.e2e-delete-tag` control (reproducing
    // the shared `tg-tag` component). Click it to remove the prefilled tag.
    fireEvent.click(container.querySelector('.tags-container .tag .e2e-delete-tag') as HTMLElement);
    expect(container.querySelector('.tags-container .tag-wrapper')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    expect(((onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues).tags).toEqual([]);
  });

  it('unassigning the prefilled user submits an empty assigned_users', async () => {
    const onSubmit = jest.fn(() => Promise.resolve());
    const { container } = render(
      <CreateEditUsLightbox {...baseProps({ mode: 'edit', us: EDIT_MODEL, onSubmit })} />,
    );

    fireEvent.click(container.querySelector('.user-list .user-list-item .remove-user') as HTMLElement);
    await act(async () => {
      fireEvent.click(container.querySelector('#submitButton') as HTMLElement);
    });
    expect(((onSubmit as jest.Mock).mock.calls[0][0] as UsFormValues).assignedUsers).toEqual([]);
  });
});

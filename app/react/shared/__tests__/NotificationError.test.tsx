/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for `app/react/shared/NotificationError.tsx`
 * — the dismissible, user-facing error toast that surfaces a REJECTED drag-and-
 * drop mutation (QA dest#8). Verifies it:
 *   - renders nothing while `message` is falsy (null / undefined / empty),
 *   - renders the existing global error-banner DOM/classes when a message is set
 *     (`.notification-message.notification-message-error.active`, role="alert",
 *     aria-live="assertive"), so the retained SCSS styles it,
 *   - invokes `onClose` on click AND on keyboard (Enter / Space) dismissal.
 */

import { render, fireEvent } from '@testing-library/react';

import { NotificationError } from '../NotificationError';

describe('NotificationError', () => {
    it('renders nothing when message is null', () => {
        const { container } = render(<NotificationError message={null} onClose={jest.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when message is undefined', () => {
        const { container } = render(
            <NotificationError message={undefined} onClose={jest.fn()} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when message is an empty string', () => {
        const { container } = render(<NotificationError message="" onClose={jest.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the error banner reusing the existing notification SCSS classes', () => {
        const { container } = render(
            <NotificationError message="Order could not be saved." onClose={jest.fn()} />,
        );
        const banner = container.querySelector('.notification-message');
        expect(banner).not.toBeNull();
        // The retained SCSS keys off these exact modifiers (error variant + the
        // `active` slide-in transform). `js-move-error` is our DnD test hook.
        expect(banner?.classList.contains('notification-message-error')).toBe(true);
        expect(banner?.classList.contains('active')).toBe(true);
        expect(banner?.classList.contains('js-move-error')).toBe(true);
    });

    it('announces itself to assistive tech (role=alert, aria-live=assertive)', () => {
        const { getByRole } = render(
            <NotificationError message="Nope." onClose={jest.fn()} />,
        );
        const alert = getByRole('alert');
        expect(alert.getAttribute('aria-live')).toBe('assertive');
    });

    it('displays the supplied message text', () => {
        const { getByText } = render(
            <NotificationError message="Sprint is closed." onClose={jest.fn()} />,
        );
        expect(getByText('Sprint is closed.')).not.toBeNull();
    });

    it('renders the error + close sprite icons', () => {
        const { container } = render(
            <NotificationError message="x" onClose={jest.fn()} />,
        );
        expect(container.querySelector('use[href="#icon-error"]')).not.toBeNull();
        expect(container.querySelector('use[href="#icon-close"]')).not.toBeNull();
    });

    it('invokes onClose when the close affordance is clicked', () => {
        const onClose = jest.fn();
        const { getByRole } = render(
            <NotificationError message="boom" onClose={onClose} />,
        );
        fireEvent.click(getByRole('button', { name: 'Dismiss error' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('invokes onClose on keyboard Enter and Space', () => {
        const onClose = jest.fn();
        const { getByRole } = render(
            <NotificationError message="boom" onClose={onClose} />,
        );
        const close = getByRole('button', { name: 'Dismiss error' });
        fireEvent.keyDown(close, { key: 'Enter' });
        fireEvent.keyDown(close, { key: ' ' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('does NOT invoke onClose for other keys', () => {
        const onClose = jest.fn();
        const { getByRole } = render(
            <NotificationError message="boom" onClose={onClose} />,
        );
        fireEvent.keyDown(getByRole('button', { name: 'Dismiss error' }), { key: 'a' });
        expect(onClose).not.toHaveBeenCalled();
    });
});

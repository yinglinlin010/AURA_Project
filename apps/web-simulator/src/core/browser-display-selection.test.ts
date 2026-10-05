import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DISPLAY_REGISTRATIONS, canSendDisplayCommand, canUseDisplay, isTrustedDisplayWelcome,
  parseBrowserDisplaySelection, selectedDisplayRegistrations,
} from './browser-display-selection.js';

test('default overview selects all five existing registry roles', () => {
  for (const search of ['', '?theme=dark']) {
    const selection = parseBrowserDisplaySelection(search);
    assert.deepEqual(selection, { mode: 'overview' });
    assert.equal(selectedDisplayRegistrations(selection).length, 5);
    assert.ok(DISPLAY_REGISTRATIONS.every(({ displayId }) => canUseDisplay(selection, displayId)));
  }
});

test('each explicit display selects exactly its own registration and render surface', () => {
  for (const registration of DISPLAY_REGISTRATIONS) {
    const selection = parseBrowserDisplaySelection(`?display=${registration.displayId}`);
    assert.deepEqual(selectedDisplayRegistrations(selection), [registration]);
    for (const other of DISPLAY_REGISTRATIONS) {
      assert.equal(canUseDisplay(selection, other.displayId), other.displayId === registration.displayId);
    }
  }
});

test('invalid, empty, duplicate and ambiguous entries fail closed with zero registrations', () => {
  for (const search of ['?display=', '?display', '?display=center', '?display=unknown', '?display=CENTER-MAIN',
    '?display=%20center-main', '?display=center-main%20', '?display=center-main&display=rear-tablet',
    '?display=center-main&display=center-main', '?display=%00center-main', '?display=cluster-main%2Frear-tablet']) {
    const selection = parseBrowserDisplaySelection(search);
    assert.deepEqual(selection, { mode: 'invalid' }, search);
    assert.equal(selectedDisplayRegistrations(selection).length, 0);
    for (const { displayId } of DISPLAY_REGISTRATIONS) {
      assert.equal(canUseDisplay(selection, displayId), false);
      assert.equal(canSendDisplayCommand(selection, displayId, 'action.consent'), false);
    }
  }
});

test('standard URL decoding works without accepting role aliases or fuzzy matches', () => {
  assert.deepEqual(parseBrowserDisplaySelection('?display=%63enter-main&theme=dark'), { mode: 'single', displayId: 'center-main' });
  assert.deepEqual(parseBrowserDisplaySelection('?display=front_passenger'), { mode: 'invalid' });
});

test('Center-only consent and console reports cannot be sent from passenger, rear, cluster or window', () => {
  for (const { displayId } of DISPLAY_REGISTRATIONS) {
    const selection = parseBrowserDisplaySelection(`?display=${displayId}`);
    for (const type of ['action.consent', 'vehicle.telemetry.report', 'driver.cognitive_load.report', 'connectivity.mode.report']) {
      assert.equal(canSendDisplayCommand(selection, displayId, type), displayId === 'center-main');
      assert.equal(canSendDisplayCommand(selection, 'center-main', type), displayId === 'center-main');
    }
    // Voice/task/recommendation use the same selected-Center gate, independent of URL parameters naming a role.
    assert.equal(canUseDisplay(selection, 'center-main'), displayId === 'center-main');
    assert.equal(canUseDisplay(selection, 'front-passenger-main'), displayId === 'front-passenger-main');
  }
});

test('Passenger and Rear keep proposal permission but cannot impersonate another display', () => {
  for (const { displayId } of DISPLAY_REGISTRATIONS) {
    const selection = parseBrowserDisplaySelection(`?display=${displayId}`);
    assert.equal(canSendDisplayCommand(selection, displayId, 'action.propose'),
      ['center-main', 'front-passenger-main', 'rear-tablet', 'window-tablet'].includes(displayId));
    for (const other of DISPLAY_REGISTRATIONS.filter((item) => item.displayId !== displayId)) {
      assert.equal(canSendDisplayCommand(selection, other.displayId, 'action.propose'), false);
    }
    assert.equal(canSendDisplayCommand(selection, displayId, 'unknown.command'), false);
  }
});

test('overview preserves existing command routes while read-only roles stay read-only', () => {
  const selection = parseBrowserDisplaySelection('');
  assert.equal(canSendDisplayCommand(selection, 'center-main', 'action.consent'), true);
  assert.equal(canSendDisplayCommand(selection, 'rear-tablet', 'action.propose'), true);
  assert.equal(canSendDisplayCommand(selection, 'front-passenger-main', 'action.propose'), true);
  assert.equal(canSendDisplayCommand(selection, 'cluster-main', 'action.propose'), false);
  assert.equal(canSendDisplayCommand(selection, 'window-tablet', 'action.propose'), true);
});

test('entry registration list matches the authoritative current registry config', () => {
  const registry = JSON.parse(readFileSync('apps/core-host/config/display-registry.json', 'utf8')) as {
    displays: Array<{ displayId: string; deviceId: string; role: string; enabled: boolean }>;
  };
  assert.deepEqual(DISPLAY_REGISTRATIONS, registry.displays.filter((item) => item.enabled).map(({ displayId, deviceId, role }) => ({ displayId, deviceId, role })));
});

test('welcome accepts the current Gateway contract without inventing required presence or device fields', () => {
  for (const registration of DISPLAY_REGISTRATIONS) {
    const valid = { kind: 'welcome', protocolVersion: 1, sessionId: 'runtime-session', sequence: 0,
      displayId: registration.displayId, role: registration.role };
    assert.equal(isTrustedDisplayWelcome(registration, valid), true);
    for (const patch of [{ protocolVersion: 2 }, { protocolVersion: undefined }, { displayId: 'other' },
      { role: 'wrong' }, { sessionId: '' }, { sequence: -1 }, { sequence: 1.5 }, { sequence: '0' }]) {
      assert.equal(isTrustedDisplayWelcome(registration, { ...valid, ...patch }), false);
    }
    assert.equal(isTrustedDisplayWelcome(registration, null), false);
    assert.equal(isTrustedDisplayWelcome(registration, []), false);
  }
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import {
  getThreadSelectors,
  selectedThreadSelectors,
} from 'firefox-profiler/selectors';
import {
  INSTANT,
  INTERVAL,
  INTERVAL_START,
  INTERVAL_END,
} from 'firefox-profiler/app-logic/constants';
import { processProfile } from '../../profile-logic/process-profile';
import {
  filterRawMarkerTableToRange,
  filterRawMarkerTableToRangeWithMarkersToDelete,
} from '../../profile-logic/marker-data';

import {
  createGeckoProfile,
  createGeckoProfileWithMarkers,
} from '../fixtures/profiles/gecko-profile';
import {
  getTestFriendlyDerivedMarkerInfo,
  type TestDefinedRawMarker,
  getThreadWithRawMarkers,
  makeInterval,
  makeInstant,
  makeCompositorScreenshot,
  makeStart,
  makeEnd__,
} from '../fixtures/profiles/processed-profile';
import { storeWithProfile } from '../fixtures/stores';

import type {
  IndexIntoRawMarkerTable,
  Milliseconds,
} from 'firefox-profiler/types';

describe('Derive markers from Gecko phase markers', function() {
  function setupWithTestDefinedMarkers(markers) {
    const profile = processProfile(createGeckoProfileWithMarkers(markers));
    profile.meta.symbolicated = true; // Avoid symbolication.
    const { getState } = storeWithProfile(profile);
    const mainGetMarker = selectedThreadSelectors.getMarkerGetter(getState());

    return {
      profile,
      getState,
      markers: selectedThreadSelectors
        .getFullMarkerListIndexes(getState())
        .map(mainGetMarker),
    };
  }

  it('creates an instant marker', function() {
    const { markers } = setupWithTestDefinedMarkers([
      {
        startTime: 5,
        endTime: null,
        phase: INSTANT,
      },
    ]);

    expect(markers).toEqual([
      {
        category: 0,
        data: null,
        dur: 0,
        name: 'TestDefinedMarker',
        start: 5,
        title: null,
      },
    ]);
  });

  it('creates an interval marker', function() {
    const { markers } = setupWithTestDefinedMarkers([
      {
        startTime: 5,
        endTime: 6,
        phase: INTERVAL,
      },
    ]);

    expect(markers).toEqual([
      {
        category: 0,
        data: null,
        dur: 1,
        name: 'TestDefinedMarker',
        start: 5,
        title: null,
      },
    ]);
  });

  it('matches an IntervalStart and IntervalEnd marker', function() {
    const { markers } = setupWithTestDefinedMarkers([
      {
        startTime: 5,
        endTime: null,
        phase: INTERVAL_START,
      },
      {
        startTime: null,
        endTime: 6,
        phase: INTERVAL_END,
      },
    ]);

    expect(markers).toEqual([
      {
        category: 0,
        data: null,
        dur: 1,
        name: 'TestDefinedMarker',
        start: 5,
        title: null,
      },
    ]);
  });

  it('completes an unmatched IntervalEnd marker', function() {
    const { markers } = setupWithTestDefinedMarkers([
      {
        startTime: null,
        endTime: 6,
        phase: INTERVAL_END,
      },
    ]);

    expect(markers).toEqual([
      {
        category: 0,
        data: null,
        dur: 6,
        name: 'TestDefinedMarker',
        start: 0,
        title: null,
        incomplete: true,
      },
    ]);
  });

  it('completes an unmatched IntervalStart marker', function() {
    const startTime = 2;
    const { markers, profile } = setupWithTestDefinedMarkers([
      {
        startTime,
        endTime: null,
        phase: INTERVAL_START,
      },
    ]);

    expect(markers).toEqual([
      {
        category: 0,
        data: null,
        // This could fail in the future if we determine thread length some other way.
        dur: profile.threads[0].samples.length - startTime,
        name: 'TestDefinedMarker',
        start: 2,
        title: null,
        incomplete: true,
      },
    ]);
  });

  it('handles nested interval start/end markers', function() {
    const { markers } = setupWithTestDefinedMarkers([
      {
        startTime: 2,
        endTime: null,
        phase: INTERVAL_START,
      },
      {
        startTime: 3,
        endTime: null,
        phase: INTERVAL_START,
      },
      {
        startTime: null,
        endTime: 5,
        phase: INTERVAL_END,
      },
      {
        startTime: null,
        endTime: 7,
        phase: INTERVAL_END,
      },
    ]);

    expect(markers).toEqual([
      {
        category: 0,
        data: null,
        dur: 5,
        name: 'TestDefinedMarker',
        start: 2,
        title: null,
      },
      {
        category: 0,
        data: null,
        dur: 2,
        name: 'TestDefinedMarker',
        start: 3,
        title: null,
      },
    ]);
  });

  it('only nests markers of the same name', function() {
    const { markers } = setupWithTestDefinedMarkers([
      {
        name: 'Marker A',
        startTime: 2,
        endTime: null,
        phase: INTERVAL_START,
      },
      {
        name: 'Marker B',
        startTime: 3,
        endTime: null,
        phase: INTERVAL_START,
      },
      {
        name: 'Marker A',
        startTime: null,
        endTime: 5,
        phase: INTERVAL_END,
      },
      {
        name: 'Marker B',
        startTime: null,
        endTime: 7,
        phase: INTERVAL_END,
      },
    ]);

    expect(markers).toEqual([
      {
        category: 0,
        data: null,
        dur: 3,
        name: 'Marker A',
        start: 2,
        title: null,
      },
      {
        category: 0,
        data: null,
        dur: 4,
        name: 'Marker B',
        start: 3,
        title: null,
      },
    ]);
  });

  it('has special handling for CompositorScreenshot', function() {
    const payload1 = {
      type: 'CompositorScreenshot',
      url: 16,
      windowID: '0x136888400',
      windowWidth: 1280,
      windowHeight: 1000,
    };
    const payload2 = {
      ...payload1,
      windowWidth: 500,
    };

    const startTimeA = 2;
    const startTimeB = 5;

    const { markers, getState } = setupWithTestDefinedMarkers([
      {
        name: 'CompositorScreenshot',
        startTime: startTimeA,
        endTime: null,
        phase: INTERVAL_START,
        data: payload1,
      },
      {
        name: 'CompositorScreenshot',
        startTime: startTimeB,
        endTime: null,
        phase: INTERVAL_START,
        data: payload2,
      },
    ]);

    const threadRange = selectedThreadSelectors.getThreadRange(getState());

    expect(markers).toEqual([
      // The first has a duration from the first screenshot to the next.
      {
        category: 0,
        data: payload1,
        dur: startTimeB - startTimeA,
        name: 'CompositorScreenshot',
        start: 2,
        title: null,
      },
      // The last has a duration until the end of the thread range.
      {
        category: 0,
        data: payload2,
        dur: threadRange.end - startTimeB,
        name: 'CompositorScreenshot',
        start: startTimeB,
        title: null,
      },
    ]);
  });
});

describe('deriveMarkersFromRawMarkerTable', function() {
  function setup() {
    // We have a broken marker on purpose in our test data, which outputs an
    // error. Let's silence an error to have a clean output. We check that the
    // mock is called in one of the tests.
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const profile = processProfile(createGeckoProfile());
    profile.meta.symbolicated = true; // avoid to kick off the symbolication process
    const thread = profile.threads[0]; // This is the parent process main thread
    const contentThread = profile.threads[2]; // This is the content process main thread

    const store = storeWithProfile(profile);
    const state = store.getState();

    const mainThreadSelectors = getThreadSelectors(0);
    const contentThreadSelectors = getThreadSelectors(2);
    const mainGetMarker = mainThreadSelectors.getMarkerGetter(state);
    const contentGetMarker = contentThreadSelectors.getMarkerGetter(state);

    return {
      profile,
      markers: mainThreadSelectors
        .getFullMarkerListIndexes(state)
        .map(mainGetMarker),
      thread,
      contentThread,
      contentMarkers: contentThreadSelectors
        .getFullMarkerListIndexes(state)
        .map(contentGetMarker),
    };
  }

  it('creates a reasonable processed profile', function() {
    const { thread, contentThread } = setup();
    expect(thread.name).toBe('GeckoMain');
    expect(thread.processType).toBe('default');
    expect(contentThread.name).toBe('GeckoMain');
    expect(contentThread.processType).toBe('tab');
  });

  it('matches the snapshot', function() {
    const { markers } = setup();
    expect(markers).toMatchSnapshot();
  });

  it('creates 18 markers given the test data', function() {
    const { markers } = setup();
    const markerNames = markers.map(
      marker => (marker.data ? marker.data.type : 'null') + ':' + marker.name
    );
    expect(markerNames).toEqual([
      'tracing:Rasterize',
      'VsyncTimestamp:VsyncTimestamp',
      'tracing:Reflow',
      'tracing:Rasterize',
      'tracing:DOMEvent',
      'GCMinor:MinorGC',
      'UserTiming:UserTiming',
      'tracing:Reflow',
      'tracing:Reflow',
      'tracing:ArbitraryName',
      'Network:Load 32: https://github.com/rustwasm/wasm-bindgen/issues/5',
      'FileIO:FileIO',
      'CompositorScreenshot:CompositorScreenshot',
      'PreferenceRead:PreferenceRead',
      'IPC:IPCOut',
      'IPC:IPCOut',
      'IPC:IPCOut',
      'tracing:Rasterize',
    ]);
  });

  it('creates a marker even if there is no start or end time', function() {
    const { markers } = setup();
    expect(markers[1]).toMatchObject({
      start: 2,
      dur: 0,
      name: 'VsyncTimestamp',
      title: null,
    });
  });
  it('should create a marker', function() {
    const { markers } = setup();
    expect(markers[2]).toMatchObject({
      start: 3,
      dur: 5,
      name: 'Reflow',
      title: null,
    });
  });
  it('should fold the two reflow markers into one marker', function() {
    const { markers } = setup();
    expect(markers.length).toEqual(18);
    expect(markers[2]).toMatchObject({
      start: 3,
      dur: 5,
      name: 'Reflow',
      title: null,
    });
  });
  it('should fold the two Rasterize markers into one marker, after the reflow marker', function() {
    const { markers } = setup();
    expect(markers[3]).toMatchObject({
      start: 4,
      dur: 1,
      name: 'Rasterize',
      title: null,
    });
  });
  it('should correlate the IPC markers together and fold transferStart/transferEnd markers', function() {
    const { markers, contentMarkers } = setup();
    expect(markers[14]).toMatchObject({
      start: 30,
      dur: 1001,
      name: 'IPCOut',
      data: { phase: 'endpoint' },
    });
    expect(markers[15]).toMatchObject({
      start: 30,
      dur: 1001,
      name: 'IPCOut',
      data: { phase: 'transferStart' },
    });
    expect(contentMarkers[0]).toMatchObject({
      start: 30,
      dur: 1001,
      name: 'IPCIn',
      data: { phase: 'transferEnd' },
    });
    expect(contentMarkers[1]).toMatchObject({
      start: 30,
      dur: 1001,
      name: 'IPCIn',
      data: { phase: 'endpoint' },
    });

    expect(markers[16]).toMatchObject({
      start: 40,
      dur: 0,
      name: 'IPCOut',
      data: { phase: 'endpoint' },
    });
  });
  it('should create a marker for the MinorGC startTime/endTime marker', function() {
    const { markers } = setup();
    expect(markers[5]).toMatchObject({
      start: 11,
      dur: 1,
      name: 'MinorGC',
      title: null,
    });
  });
  it('should create a marker for the DOMEvent marker', function() {
    const { markers } = setup();
    expect(markers[4]).toMatchObject({
      dur: 1,
      name: 'DOMEvent',
      start: 9,
      title: null,
    });
  });
  it('should create a marker for the marker UserTiming', function() {
    const { markers } = setup();
    expect(markers[6]).toMatchObject({
      dur: 1,
      name: 'UserTiming',
      start: 12,
      title: null,
    });
  });
  it('should handle markers without a start', function() {
    const { markers } = setup();
    expect(markers[0]).toMatchObject({
      start: 0, // Truncated to the time of the first captured sample.
      dur: 1,
      name: 'Rasterize',
      title: null,
    });
  });
  it('should handle markers without an end', function() {
    const { markers } = setup();
    expect(markers[17]).toMatchObject({
      start: 100,
      dur: 0,
      name: 'Rasterize',
      title: null,
      incomplete: true,
    });
  });
  it('should handle nested markers correctly', function() {
    const { markers } = setup();
    expect(markers[7]).toMatchObject({
      start: 13,
      dur: 5,
      name: 'Reflow',
      title: null,
    });
    expect(markers[8]).toMatchObject({
      start: 14,
      dur: 1,
      name: 'Reflow',
      title: null,
    });
  });
  it('should handle arbitrary tracing markers correctly', function() {
    const { markers } = setup();
    expect(markers[9]).toMatchObject({
      start: 21,
      dur: 0,
      name: 'ArbitraryName',
      title: null,
      data: { category: 'ArbitraryCategory', type: 'tracing' },
    });
  });

  // Note that the network markers are also extensively tested below in the part
  // for filterRawMarkerTableToRange.
  it('shifts content process marker times correctly, especially in network markers', function() {
    const { thread, contentThread, markers, contentMarkers } = setup();
    expect(thread.processStartupTime).toBe(0);
    expect(contentThread.processStartupTime).toBe(1000);
    expect(markers[10]).toEqual({
      data: {
        type: 'Network',
        startTime: 22,
        endTime: 24,
        id: 388634410746504,
        status: 'STATUS_STOP',
        pri: -20,
        count: 37838,
        URI: 'https://github.com/rustwasm/wasm-bindgen/issues/5',
        fetchStart: 23,
        domainLookupStart: 23.1,
        domainLookupEnd: 23.2,
        connectStart: 23.3,
        tcpConnectEnd: 23.4,
        secureConnectionStart: 23.5,
        connectEnd: 23.6,
        requestStart: 23.7,
        responseStart: 23.8,
        responseEnd: 23.9,
      },
      dur: 2,
      name: 'Load 32: https://github.com/rustwasm/wasm-bindgen/issues/5',
      start: 22,
      title: null,
      category: 0,
    });
    expect(markers[14]).toEqual({
      data: {
        type: 'IPC',
        startTime: 30,
        sendStartTime: 30.1,
        sendEndTime: 30.2,
        recvEndTime: 1030.3,
        endTime: 1031,
        otherPid: 2222,
        sendTid: 3333,
        recvTid: 1111,
        sendThreadName: 'Parent Process (Thread ID: 3333)',
        recvThreadName: 'Content Process (Thread ID: 1111)',
        messageSeqno: 1,
        messageType: 'PContent::Msg_PreferenceUpdate',
        side: 'parent',
        direction: 'sending',
        phase: 'endpoint',
        sync: false,
      },
      dur: 1001,
      incomplete: false,
      name: 'IPCOut',
      start: 30,
      title: 'IPC — sent to Content Process (Thread ID: 1111)',
      category: 0,
    });

    expect(contentMarkers[1]).toEqual({
      data: {
        type: 'IPC',
        startTime: 30,
        sendStartTime: 30.1,
        sendEndTime: 30.2,
        recvEndTime: 1030.3,
        endTime: 1031,
        otherPid: 3333,
        sendTid: 3333,
        recvTid: 1111,
        sendThreadName: 'Parent Process (Thread ID: 3333)',
        recvThreadName: 'Content Process (Thread ID: 1111)',
        messageSeqno: 1,
        messageType: 'PContent::Msg_PreferenceUpdate',
        side: 'child',
        direction: 'receiving',
        phase: 'endpoint',
        sync: false,
      },
      dur: 1001,
      incomplete: false,
      name: 'IPCIn',
      start: 30,
      title: 'IPC — received from Parent Process (Thread ID: 3333)',
      category: 0,
    });
    expect(contentMarkers[12]).toEqual({
      data: {
        type: 'Network',
        startTime: 1022,
        endTime: 1024,
        id: 388634410746504,
        status: 'STATUS_STOP',
        pri: -20,
        count: 37838,
        URI: 'https://github.com/rustwasm/wasm-bindgen/issues/5',
        fetchStart: 1023,
        domainLookupStart: 1023.1,
        domainLookupEnd: 1023.2,
        connectStart: 1023.3,
        tcpConnectEnd: 1023.4,
        secureConnectionStart: 1023.5,
        connectEnd: 1023.6,
        requestStart: 1023.7,
        responseStart: 1023.8,
        responseEnd: 1023.9,
      },
      dur: 2,
      name: 'Load 32: https://github.com/rustwasm/wasm-bindgen/issues/5',
      start: 1022,
      title: null,
      category: 0,
    });
    expect(contentMarkers[13]).toEqual({
      data: {
        // Stack property is converted to a cause.
        cause: {
          stack: 2,
          time: 1,
        },
        endTime: 1024,
        filename: '/foo/bar/',
        operation: 'create/open',
        source: 'PoisionOIInterposer',
        startTime: 1022,
        type: 'FileIO',
      },
      dur: 2,
      name: 'FileIO',
      start: 1022,
      title: null,
      category: 0,
    });
  });
  it('should create a marker for the marker CompositorScreenshot', function() {
    const { markers } = setup();
    expect(markers[12]).toMatchObject({
      data: {
        type: 'CompositorScreenshot',
        url: 16,
        windowID: '0x136888400',
        windowWidth: 1280,
        windowHeight: 1000,
      },
      name: 'CompositorScreenshot',
      start: 25,
      dur: 0,
      title: null,
    });
  });
});

describe('filterRawMarkerTableToRange', () => {
  type TestConfig = {|
    start: Milliseconds,
    end: Milliseconds,
    markers: Array<TestDefinedRawMarker>,
  |};

  function setup({ start, end, markers }: TestConfig) {
    const thread = getThreadWithRawMarkers(
      markers.map(({ data, ...rest }) => ({
        ...rest,
        data: data ? ({ type: 'DummyForTests', ...data }: any) : null,
      }))
    );

    const derivedMarkerInfo = getTestFriendlyDerivedMarkerInfo(thread);
    const rawMarkerTable = filterRawMarkerTableToRange(
      thread.markers,
      derivedMarkerInfo,
      start,
      end
    );
    const rawMarkerNames = rawMarkerTable.name.map(i =>
      thread.stringTable.getString(i)
    );
    const processedMarkers = getTestFriendlyDerivedMarkerInfo({
      ...thread,
      markers: rawMarkerTable,
    }).markers;

    const processedMarkerNames = processedMarkers.map(({ name }) => name);

    return {
      rawMarkerTable,
      rawMarkerNames,
      processedMarkers,
      processedMarkerNames,
    };
  }

  it('filters instant markers', () => {
    const { rawMarkerNames } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        makeInstant('0', 0),
        makeInstant('1', 1),
        makeInstant('2', 2),
        makeInstant('3', 3),
        makeInstant('4', 4),
        makeInstant('5', 5),
        makeInstant('6', 6),
        makeInstant('7', 7),
      ],
    });
    // Note: because the test fixture utility adds the strings in order, the
    // string indices are actually the same as the name themselves, which make
    // it possible to do an easy and readable assertion.
    expect(rawMarkerNames).toEqual(['3', '4', '5']);
  });

  it('filters interval markers', () => {
    const { rawMarkerNames } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        makeInterval('0', 0, 4),
        makeInterval('1', 1, 7),
        makeInterval('2', 2, 2.2),
        makeInterval('3', 3, 4),
        makeInterval('4', 4, 6),
        makeInterval('5', 5, 5),
        makeInterval('6', 6, 8),
        makeInterval('7', 7, 7),
      ],
    });

    expect(rawMarkerNames).toEqual(['0', '1', '3', '4', '5']);
  });

  it('filters interval start/end markers', () => {
    const { processedMarkerNames } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        makeStart('InA', 0),
        makeStart('InB', 1),
        makeStart('OutA', 2),
        makeEnd__('OutA', 2.2),
        makeStart('InC', 3),
        makeStart('InD', 4),
        makeEnd__('InC', 4),
        makeEnd__('InA', 4),
        makeStart('InE', 5),
        makeEnd__('InE', 5),
        makeStart('OutB', 6),
        makeEnd__('InD', 6),
        makeStart('OutC', 7),
        makeEnd__('OutC', 7),
        makeEnd__('InB', 7),
        makeEnd__('OutB', 8),
      ],
    });
    expect(processedMarkerNames.sort()).toEqual([
      'InA',
      'InB',
      'InC',
      'InD',
      'InE',
    ]);
  });

  it('filters nested tracing markers', () => {
    // In this test we're testing the more complex case of nested markers
    const { processedMarkerNames } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        makeStart('Marker', 0),
        makeStart('Marker', 1),
        makeEnd__('Marker', 2),
        makeEnd__('Marker', 6),
      ],
    });

    expect(processedMarkerNames).toEqual(['Marker']);
  });

  it('filters screenshot markers', () => {
    const { rawMarkerTable } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        makeCompositorScreenshot(0),
        makeCompositorScreenshot(3),
        makeCompositorScreenshot(7),
      ],
    });

    expect(rawMarkerTable.startTime).toEqual([0, 3]);
  });

  it('keeps a screenshot markers happening before the range if there is no other marker', () => {
    const { processedMarkerNames } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        makeCompositorScreenshot(0),
        // The compositor marker will be all the way to the last marker.
        makeInstant('EndMarkerOutOfRange', 8),
      ],
    });
    expect(processedMarkerNames).toEqual(['CompositorScreenshot']);
  });

  it('filters network markers', () => {
    const rest = {
      type: 'Network',
      URI: 'https://example.com',
      pri: 0,
      startTime: 0,
      endTime: 0,
    };

    const { processedMarkers } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        {
          name: 'Load 1',
          startTime: 0,
          endTime: 1,
          phase: INTERVAL,
          data: { ...rest, id: 1, status: 'STATUS_START' },
        },
        {
          name: 'Load 2',
          startTime: 0,
          endTime: 1,
          phase: INTERVAL,
          data: { ...rest, id: 2, status: 'STATUS_START' },
        },
        {
          name: 'Load 4 will be filtered',
          startTime: 0,
          endTime: 1,
          phase: INTERVAL,
          data: { ...rest, id: 4, status: 'STATUS_START' },
        },
        {
          name: 'Load 4 will be filtered',
          startTime: 1,
          endTime: 2,
          phase: INTERVAL,
          data: { ...rest, id: 4, status: 'STATUS_STOP' },
        },
        {
          name: 'Load 1',
          startTime: 1,
          endTime: 3,
          phase: INTERVAL,
          data: { ...rest, id: 1, status: 'STATUS_STOP' },
        },
        {
          name: 'Load 2',
          startTime: 1,
          endTime: 7,
          phase: INTERVAL,
          data: { ...rest, id: 2, status: 'STATUS_STOP' },
        },
        {
          name: 'Load 3',
          startTime: 2,
          phase: INTERVAL,
          endTime: 6,
          data: { ...rest, id: 3, status: 'STATUS_START' },
        },
        {
          name: 'Load 3',
          startTime: 6,
          endTime: 7,
          phase: INTERVAL,
          data: { ...rest, id: 3, status: 'STATUS_STOP' },
        },
        {
          name: 'Load 5 will be filtered',
          startTime: 6,
          endTime: 7,
          phase: INTERVAL,
          data: { ...rest, id: 5, status: 'STATUS_START' },
        },
        {
          name: 'Load 5 will be filtered',
          startTime: 7,
          endTime: 8,
          phase: INTERVAL,
          data: { ...rest, id: 5, status: 'STATUS_STOP' },
        },
      ],
    });

    expect(
      processedMarkers.map(marker => [
        marker.name,
        marker.data && (marker.data: any).id,
        marker.data && (marker.data: any).status,
        marker.start,
        marker.start + marker.dur,
      ])
    ).toEqual([
      ['Load 1', 1, 'STATUS_STOP', 0, 3],
      ['Load 2', 2, 'STATUS_STOP', 0, 7],
      ['Load 3', 3, 'STATUS_STOP', 2, 7],
    ]);
  });

  it('filters network markers with only a start marker', () => {
    const rest = {
      type: 'Network',
      URI: 'https://example.com',
      pri: 0,
      startTime: 0,
      endTime: 0,
    };

    const { processedMarkers } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        {
          name: 'Load 1',
          startTime: 0,
          endTime: 1,
          phase: INTERVAL,
          data: { id: 1, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 2',
          startTime: 2,
          endTime: 4,
          phase: INTERVAL,
          data: { id: 2, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 3',
          startTime: 2,
          endTime: 6,
          phase: INTERVAL,
          data: { id: 3, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 4',
          startTime: 3,
          endTime: 5,
          phase: INTERVAL,
          data: { id: 4, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 5',
          startTime: 3,
          endTime: 7,
          phase: INTERVAL,
          data: { id: 5, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 6',
          startTime: 6,
          endTime: 7,
          phase: INTERVAL,
          data: { id: 6, status: 'STATUS_START', ...rest },
        },
      ],
    });

    const result = processedMarkers.map(marker => [
      marker.name,
      marker.data && (marker.data: any).id,
    ]);

    expect(result).toEqual([
      ['Load 1', 1],
      ['Load 2', 2],
      ['Load 3', 3],
      ['Load 4', 4],
      ['Load 5', 5],
    ]);
  });

  it('filters network markers with only an end marker', () => {
    const rest = {
      type: 'Network',
      URI: 'https://example.com',
      pri: 0,
      startTime: 0,
      endTime: 0,
    };

    const { processedMarkers } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        {
          name: 'Load 1',
          startTime: 0,
          endTime: 1,
          phase: INTERVAL,
          data: { id: 1, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 2',
          startTime: 2,
          endTime: 4,
          phase: INTERVAL,
          data: { id: 2, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 3',
          startTime: 2,
          endTime: 6,
          phase: INTERVAL,
          data: { id: 3, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 4',
          startTime: 3,
          endTime: 5,
          phase: INTERVAL,
          data: { id: 4, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 5',
          startTime: 3,
          endTime: 7,
          phase: INTERVAL,
          data: { id: 5, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 6',
          startTime: 6,
          endTime: 7,
          phase: INTERVAL,
          data: { ...rest, id: 6, status: 'STATUS_STOP' },
        },
      ],
    });

    expect(
      processedMarkers.map(marker => [
        marker.name,
        marker.data && (marker.data: any).id,
      ])
    ).toEqual([
      ['Load 2', 2],
      ['Load 3', 3],
      ['Load 4', 4],
      ['Load 5', 5],
      ['Load 6', 6],
    ]);
  });

  it('filters network markers based on their ids', () => {
    const rest = {
      type: 'Network',
      URI: 'https://example.com',
      pri: 0,
      startTime: 0,
      endTime: 0,
    };

    // Network markers can be unique despite sharing the same name if
    // they are from processes with different process ids which are
    // stored in the highest 4 bytes.
    const { processedMarkers } = setup({
      start: 2.3,
      end: 5.6,
      markers: [
        {
          name: 'Load 1',
          startTime: 0,
          endTime: 1,
          phase: INTERVAL,
          data: { id: 0x0000000100000001, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 1',
          startTime: 0,
          endTime: 1,
          phase: INTERVAL,
          data: { id: 0x0000000200000001, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 2',
          startTime: 1,
          endTime: 2,
          phase: INTERVAL,
          data: { id: 0x0000000200000002, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 1',
          startTime: 1,
          endTime: 3,
          phase: INTERVAL,
          data: { id: 0x0000000100000001, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 2',
          startTime: 2,
          endTime: 4,
          phase: INTERVAL,
          data: { id: 0x0000000100000002, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 2',
          startTime: 4,
          endTime: 7,
          phase: INTERVAL,
          data: { id: 0x0000000100000002, status: 'STATUS_STOP', ...rest },
        },
        {
          name: 'Load 2',
          startTime: 5,
          endTime: 6,
          phase: INTERVAL,
          data: { id: 0x0000000300000002, status: 'STATUS_START', ...rest },
        },
        {
          name: 'Load 2',
          startTime: 6,
          endTime: 7,
          phase: INTERVAL,
          data: { id: 0x0000000300000002, status: 'STATUS_STOP', ...rest },
        },
      ],
    });

    expect(
      processedMarkers.map(marker => [
        marker.name,
        marker.data && (marker.data: any).id,
      ])
    ).toEqual([
      ['Load 1', 0x0000000100000001],
      ['Load 2', 0x0000000100000002],
      ['Load 2', 0x0000000300000002],
      ['Load 1', 0x0000000200000001],
    ]);
  });
});

// We don't need to test with other marker types since they are already being
// tested in `filterRawMarkerTableToRange` tests.
describe('filterRawMarkerTableToRangeWithMarkersToDelete', () => {
  function setup(
    markers: Array<[string, Milliseconds, null | Object]>
  ): Thread {
    markers = markers.map(([name, time, payload]) => {
      if (payload) {
        // Force a type 'DummyForTests' if it's inexistant
        payload = { type: 'DummyForTests', ...payload };
      }
      return [name, time, payload];
    });

    // Our marker payload union type is too difficult to work with in a
    // generic way here.
    return getThreadWithMarkers((markers: any));
  }

  it('filters generic markers without markerToDelete', () => {
    const markers = [
      ['A', 0, null],
      ['B', 1, null],
      ['C', 2, null],
      ['D', 3, null],
      ['E', 4, null],
      ['F', 5, null],
      ['G', 6, null],
      ['H', 7, null],
    ];
    const { markers: markerTable, stringTable } = setup(markers);
    const filteredMarkerTable = filterRawMarkerTableToRangeWithMarkersToDelete(
      markerTable,
      new Set(),
      { start: 2.3, end: 5.6 }
    ).rawMarkerTable;
    const filteredMarkerNames = filteredMarkerTable.name.map(stringIndex =>
      stringTable.getString(stringIndex)
    );
    expect(filteredMarkerNames).toEqual(['D', 'E', 'F']);
  });

  it('filters generic markers with markerToDelete', () => {
    const markers = [
      ['A', 0, null],
      ['B', 1, null],
      ['C', 2, null],
      ['D', 3, null],
      ['E', 4, null],
      ['F', 5, null],
      ['G', 6, null],
      ['H', 7, null],
    ];

    const { markers: markerTable, stringTable } = setup(markers);
    const markersToDelete = new Set([3, 5]);
    const filteredMarkerTable = filterRawMarkerTableToRangeWithMarkersToDelete(
      markerTable,
      markersToDelete,
      { start: 2.3, end: 5.6 }
    ).rawMarkerTable;

    const filteredMarkerNames = filteredMarkerTable.name.map(stringIndex =>
      stringTable.getString(stringIndex)
    );
    expect(filteredMarkerNames).toEqual(['E']);
  });

  it('filters generic markers with markerToDelete but without time range', () => {
    const markers = [
      ['A', 0, null],
      ['B', 1, null],
      ['C', 2, null],
      ['D', 3, null],
      ['E', 4, null],
      ['F', 5, null],
      ['G', 6, null],
      ['H', 7, null],
    ];
    const { markers: markerTable, stringTable } = setup(markers);
    const markersToDelete = new Set([2, 3, 5, 7]);
    const filteredMarkerTable = filterRawMarkerTableToRangeWithMarkersToDelete(
      markerTable,
      markersToDelete,
      null
    ).rawMarkerTable;

    const filteredMarkerNames = filteredMarkerTable.name.map(stringIndex =>
      stringTable.getString(stringIndex)
    );
    expect(filteredMarkerNames).toEqual(['A', 'B', 'E', 'G']);
  });
});

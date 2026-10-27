import { applyViewState } from './logic/view-state';

if (window.__IGNATIUS_MODE__ === 'static') applyViewState(window, localStorage, location);

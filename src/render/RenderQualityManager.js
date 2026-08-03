const QUALITY_PROFILES = Object.freeze({
  fast: Object.freeze({ baseScale: 0.85, minScale: 0.7, maxScale: 1, shadowMap: 512, targetFrameMs: 33.3 }),
  balanced: Object.freeze({ baseScale: 1, minScale: 0.8, maxScale: 1.25, shadowMap: 1024, targetFrameMs: 22.2 }),
  high: Object.freeze({ baseScale: 1.15, minScale: 1, maxScale: 1.5, shadowMap: 2048, targetFrameMs: 18.2 }),
});

export class RenderQualityManager {
  constructor({
    windowRef = globalThis,
    profile = 'balanced',
    settledDelay = 300,
    onStateChange = () => {},
    onScaleChange = () => {},
  } = {}) {
    this.windowRef = windowRef;
    this.profile = QUALITY_PROFILES[profile] ? profile : 'balanced';
    this.settledDelay = settledDelay;
    this.onStateChange = onStateChange;
    this.onScaleChange = onScaleChange;
    this.state = 'interactive';
    this.scale = QUALITY_PROFILES[this.profile].baseScale;
    this.settleTimer = null;
    this.frameTimes = [];
    this.lastFrameTime = null;
    this.exporting = false;
  }

  getProfile() {
    return QUALITY_PROFILES[this.profile];
  }

  setProfile(profile) {
    if (!QUALITY_PROFILES[profile] || profile === this.profile) return;
    this.profile = profile;
    this.setScale(this.getProfile().baseScale);
  }

  setState(state) {
    if (!['interactive', 'settled', 'export'].includes(state)) return;
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }

  markInteraction() {
    if (this.exporting) return;
    this.windowRef.clearTimeout?.(this.settleTimer);
    this.setState('interactive');
    this.settleTimer = this.windowRef.setTimeout?.(() => {
      if (!this.exporting) this.setState('settled');
    }, this.settledDelay);
  }

  beginExport() {
    this.windowRef.clearTimeout?.(this.settleTimer);
    this.exporting = true;
    this.setState('export');
  }

  endExport(previousState = 'settled') {
    this.exporting = false;
    this.setState(previousState === 'export' ? 'settled' : previousState);
  }

  setScale(scale) {
    const profile = this.getProfile();
    const next = Math.max(profile.minScale, Math.min(profile.maxScale, Number(scale) || profile.baseScale));
    if (Math.abs(next - this.scale) < 0.01) return;
    this.scale = next;
    this.onScaleChange(next);
  }

  recordFrame(frameTimeMs) {
    if (this.state === 'export' || !Number.isFinite(frameTimeMs)) return;
    this.frameTimes.push(frameTimeMs);
    if (this.frameTimes.length > 8) this.frameTimes.shift();
    if (this.frameTimes.length < 8) return;
    const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
    const profile = this.getProfile();
    if (average > profile.targetFrameMs * 1.2) this.setScale(this.scale - 0.05);
    else if (average < profile.targetFrameMs * 0.75) this.setScale(this.scale + 0.05);
    this.lastFrameTime = average;
  }

  getDiagnostics() {
    const sortedFrameTimes = [...this.frameTimes].sort((left, right) => left - right);
    const p95Index = sortedFrameTimes.length
      ? Math.min(sortedFrameTimes.length - 1, Math.ceil(sortedFrameTimes.length * 0.95) - 1)
      : -1;
    return {
      state: this.state,
      profile: this.profile,
      renderScale: this.scale,
      frameTime: this.lastFrameTime,
      frameTimeP95: p95Index >= 0 ? sortedFrameTimes[p95Index] : null,
      targetFrameMs: this.getProfile().targetFrameMs,
      sampleCount: this.frameTimes.length,
    };
  }

  dispose() {
    this.windowRef.clearTimeout?.(this.settleTimer);
    this.settleTimer = null;
    this.frameTimes = [];
  }
}

export { QUALITY_PROFILES };

// Wall/monotonic discontinuities postpone, rather than catch up, a scheduled fetch.
export class RefreshSchedule {
    constructor(interval, wall, monotonic) {
        this.reset(interval, wall, monotonic);
    }

    reset(interval, wall, monotonic) {
        this.interval = interval;
        this.deadline = monotonic + interval;
        this.wall = wall;
        this.monotonic = monotonic;
    }

    tick(wall, monotonic) {
        const wallGap = wall - this.wall;
        const monotonicGap = monotonic - this.monotonic;
        // Covers resume without logind signals, large clock changes and long stalls.
        if (Math.abs(wallGap - monotonicGap) > 30_000 || monotonicGap > 60_000) {
            this.reset(this.interval, wall, monotonic);
            return false;
        }
        this.wall = wall;
        this.monotonic = monotonic;
        if (monotonic < this.deadline) return false;
        this.deadline = monotonic + this.interval;
        return true;
    }
}

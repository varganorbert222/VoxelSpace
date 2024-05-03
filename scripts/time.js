class Time {
    get deltaTime() {
        return this._deltaTime;
    }

    constructor() {
        this._elapsedTimeForDeltaTime = 0;
        this._deltaTime = 0;
        this.cycle();
    }

    cycle() {
        const currentTime = new Date().getTime();
        this._deltaTime = currentTime - this._elapsedTimeForDeltaTime;
        this._elapsedTimeForDeltaTime = currentTime;

        window.requestAnimationFrame(() => {
            this.cycle();
        });
    }
}

const time = new Time();
export default time;
(() => {
  class RoomAPI {
    constructor() {
      this.socket = io({ transports: ['websocket', 'polling'] });
      this.listeners = new Set();
      this.socket.on('room:update', room => this.emit({ type: 'update', room }));
      this.socket.on('room:closed', data => this.emit({ type: 'closed', ...data }));
    }
    emit(event) { for (const fn of this.listeners) fn(event); }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    call(event, payload = {}) {
      return new Promise((resolve, reject) => {
        this.socket.emit(event, payload, res => {
          if (!res?.ok) reject(new Error(res?.error || 'Có lỗi xảy ra.'));
          else resolve(res);
        });
      });
    }
    create(payload) { return this.call('room:create', payload); }
    join(payload) { return this.call('room:join', payload); }
    get(payload) { return this.call('room:get', payload); }
    start(payload) { return this.call('room:start', payload); }
    check(payload) { return this.call('room:check', payload); }
    submit(payload) { return this.call('room:submit', payload); }
    leave(payload) { return this.call('room:leave', payload); }
  }
  window.RoomAPI = RoomAPI;
})();

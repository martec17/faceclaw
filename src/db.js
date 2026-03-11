import { Preferences } from '@capacitor/preferences';

export async function initDB() {
    // Capacitor Preferences doesn't require complex instantiation.
    console.log("KV DB initialized natively");
    return true;
}

export async function getMessages() {
    try {
        const { value } = await Preferences.get({ key: 'messages' });
        return value ? JSON.parse(value) : [];
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function addMessage(role, content, timestamp) {
    try {
        const msgs = await getMessages();
        const newMsg = { id: timestamp, role, content, timestamp };
        msgs.push(newMsg);
        // Keep only last 1000 to prevent crazy local storage limits if it ever happens
        if (msgs.length > 1000) msgs.shift();
        await Preferences.set({ key: 'messages', value: JSON.stringify(msgs) });
    } catch (e) {
        console.error(e);
    }
}

export async function getMemory() {
    try {
        const { value } = await Preferences.get({ key: 'memory' });
        return value || '';
    } catch (e) {
        console.error(e);
        return '';
    }
}

export async function updateMemory(context) {
    try {
        await Preferences.set({ key: 'memory', value: context });
    } catch (e) {
        console.error(e);
    }
}

export async function clearDB() {
    try {
        await Preferences.remove({ key: 'messages' });
        await Preferences.remove({ key: 'memory' });
    } catch (e) {
        console.error(e);
    }
}

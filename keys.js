// keys.js — the keyboard as vibecheck needs to see it.
//
// One row per key: the uiohook keycode the global hook reports, the DOM
// KeyboardEvent.code the settings window sees, the X keysym name the
// desktop-level binding (GNOME/KDE) wants, and a label for humans.
//
// The hook only ever needs the keycode, so a key missing from this table
// still works as a shortcut — it just can't be handed to the desktop,
// which insists on a name. Codes mirror libuiohook's VC_* constants.
const ROWS = [
  [0x0001, 'Escape', 'Escape', 'Esc'],

  [0x003b, 'F1', 'F1', 'F1'],
  [0x003c, 'F2', 'F2', 'F2'],
  [0x003d, 'F3', 'F3', 'F3'],
  [0x003e, 'F4', 'F4', 'F4'],
  [0x003f, 'F5', 'F5', 'F5'],
  [0x0040, 'F6', 'F6', 'F6'],
  [0x0041, 'F7', 'F7', 'F7'],
  [0x0042, 'F8', 'F8', 'F8'],
  [0x0043, 'F9', 'F9', 'F9'],
  [0x0044, 'F10', 'F10', 'F10'],
  [0x0057, 'F11', 'F11', 'F11'],
  [0x0058, 'F12', 'F12', 'F12'],
  // F13+ never sit on a laptop deck, but external and programmable boards
  // hand them out freely — which makes them the best shortcuts there are
  [0x005b, 'F13', 'F13', 'F13'],
  [0x005c, 'F14', 'F14', 'F14'],
  [0x005d, 'F15', 'F15', 'F15'],
  [0x0063, 'F16', 'F16', 'F16'],
  [0x0064, 'F17', 'F17', 'F17'],
  [0x0065, 'F18', 'F18', 'F18'],
  [0x0066, 'F19', 'F19', 'F19'],
  [0x0067, 'F20', 'F20', 'F20'],
  [0x0068, 'F21', 'F21', 'F21'],
  [0x0069, 'F22', 'F22', 'F22'],
  [0x006a, 'F23', 'F23', 'F23'],
  [0x006b, 'F24', 'F24', 'F24'],

  [0x0029, 'Backquote', 'grave', '`'],
  [0x0002, 'Digit1', '1', '1'],
  [0x0003, 'Digit2', '2', '2'],
  [0x0004, 'Digit3', '3', '3'],
  [0x0005, 'Digit4', '4', '4'],
  [0x0006, 'Digit5', '5', '5'],
  [0x0007, 'Digit6', '6', '6'],
  [0x0008, 'Digit7', '7', '7'],
  [0x0009, 'Digit8', '8', '8'],
  [0x000a, 'Digit9', '9', '9'],
  [0x000b, 'Digit0', '0', '0'],
  [0x000c, 'Minus', 'minus', '-'],
  [0x000d, 'Equal', 'equal', '='],
  [0x000e, 'Backspace', 'BackSpace', 'Backspace'],

  [0x000f, 'Tab', 'Tab', 'Tab'],
  [0x003a, 'CapsLock', 'Caps_Lock', 'Caps Lock'],

  [0x001e, 'KeyA', 'a', 'A'],
  [0x0030, 'KeyB', 'b', 'B'],
  [0x002e, 'KeyC', 'c', 'C'],
  [0x0020, 'KeyD', 'd', 'D'],
  [0x0012, 'KeyE', 'e', 'E'],
  [0x0021, 'KeyF', 'f', 'F'],
  [0x0022, 'KeyG', 'g', 'G'],
  [0x0023, 'KeyH', 'h', 'H'],
  [0x0017, 'KeyI', 'i', 'I'],
  [0x0024, 'KeyJ', 'j', 'J'],
  [0x0025, 'KeyK', 'k', 'K'],
  [0x0026, 'KeyL', 'l', 'L'],
  [0x0032, 'KeyM', 'm', 'M'],
  [0x0031, 'KeyN', 'n', 'N'],
  [0x0018, 'KeyO', 'o', 'O'],
  [0x0019, 'KeyP', 'p', 'P'],
  [0x0010, 'KeyQ', 'q', 'Q'],
  [0x0013, 'KeyR', 'r', 'R'],
  [0x001f, 'KeyS', 's', 'S'],
  [0x0014, 'KeyT', 't', 'T'],
  [0x0016, 'KeyU', 'u', 'U'],
  [0x002f, 'KeyV', 'v', 'V'],
  [0x0011, 'KeyW', 'w', 'W'],
  [0x002d, 'KeyX', 'x', 'X'],
  [0x0015, 'KeyY', 'y', 'Y'],
  [0x002c, 'KeyZ', 'z', 'Z'],

  [0x001a, 'BracketLeft', 'bracketleft', '['],
  [0x001b, 'BracketRight', 'bracketright', ']'],
  [0x002b, 'Backslash', 'backslash', '\\'],
  [0x0027, 'Semicolon', 'semicolon', ';'],
  [0x0028, 'Quote', 'apostrophe', "'"],
  [0x001c, 'Enter', 'Return', 'Enter'],
  [0x0033, 'Comma', 'comma', ','],
  [0x0034, 'Period', 'period', '.'],
  [0x0035, 'Slash', 'slash', '/'],
  [0x0039, 'Space', 'space', 'Space'],
  [0x0e46, 'IntlBackslash', 'less', '< >'],

  [0x0e37, 'PrintScreen', 'Print', 'Print Screen'],
  [0x0046, 'ScrollLock', 'Scroll_Lock', 'Scroll Lock'],
  [0x0e45, 'Pause', 'Pause', 'Pause'],

  [0x0e52, 'Insert', 'Insert', 'Insert'],
  [0x0e53, 'Delete', 'Delete', 'Delete'],
  [0x0e47, 'Home', 'Home', 'Home'],
  [0x0e4f, 'End', 'End', 'End'],
  [0x0e49, 'PageUp', 'Prior', 'Page Up'],
  [0x0e51, 'PageDown', 'Next', 'Page Down'],

  [0xe048, 'ArrowUp', 'Up', 'Up Arrow'],
  [0xe04b, 'ArrowLeft', 'Left', 'Left Arrow'],
  [0xe04d, 'ArrowRight', 'Right', 'Right Arrow'],
  [0xe050, 'ArrowDown', 'Down', 'Down Arrow'],
  [0xe04c, null, 'Clear', 'Clear'],

  [0x0045, 'NumLock', 'Num_Lock', 'Num Lock'],
  [0x0e35, 'NumpadDivide', 'KP_Divide', 'Numpad /'],
  [0x0037, 'NumpadMultiply', 'KP_Multiply', 'Numpad *'],
  [0x004a, 'NumpadSubtract', 'KP_Subtract', 'Numpad -'],
  [0x004e, 'NumpadAdd', 'KP_Add', 'Numpad +'],
  [0x0e0d, 'NumpadEqual', 'KP_Equal', 'Numpad ='],
  [0x0e1c, 'NumpadEnter', 'KP_Enter', 'Numpad Enter'],
  [0x0053, 'NumpadDecimal', 'KP_Decimal', 'Numpad .'],
  [0x004f, 'Numpad1', 'KP_1', 'Numpad 1'],
  [0x0050, 'Numpad2', 'KP_2', 'Numpad 2'],
  [0x0051, 'Numpad3', 'KP_3', 'Numpad 3'],
  [0x004b, 'Numpad4', 'KP_4', 'Numpad 4'],
  [0x004c, 'Numpad5', 'KP_5', 'Numpad 5'],
  [0x004d, 'Numpad6', 'KP_6', 'Numpad 6'],
  [0x0047, 'Numpad7', 'KP_7', 'Numpad 7'],
  [0x0048, 'Numpad8', 'KP_8', 'Numpad 8'],
  [0x0049, 'Numpad9', 'KP_9', 'Numpad 9'],
  [0x0052, 'Numpad0', 'KP_0', 'Numpad 0'],
  // same physical keys with Num Lock off — a different code on the wire,
  // so they get their own rows (DOM can't tell them apart, hence no code)
  [0xee4f, null, 'KP_End', 'Numpad End'],
  [0xee50, null, 'KP_Down', 'Numpad Down'],
  [0xee51, null, 'KP_Next', 'Numpad Page Down'],
  [0xee4b, null, 'KP_Left', 'Numpad Left'],
  [0xee4c, null, 'KP_Begin', 'Numpad Begin'],
  [0xee4d, null, 'KP_Right', 'Numpad Right'],
  [0xee47, null, 'KP_Home', 'Numpad Home'],
  [0xee48, null, 'KP_Up', 'Numpad Up'],
  [0xee49, null, 'KP_Prior', 'Numpad Page Up'],
  [0xee52, null, 'KP_Insert', 'Numpad Insert'],
  [0xee53, null, 'KP_Delete', 'Numpad Delete'],

  [0x002a, 'ShiftLeft', 'Shift_L', 'Left Shift'],
  [0x0036, 'ShiftRight', 'Shift_R', 'Right Shift'],
  [0x001d, 'ControlLeft', 'Control_L', 'Left Ctrl'],
  [0x0e1d, 'ControlRight', 'Control_R', 'Right Ctrl'],
  [0x0038, 'AltLeft', 'Alt_L', 'Left Alt'],
  [0x0e38, 'AltRight', 'Alt_R', 'Right Alt'],
  [0x0e5b, 'MetaLeft', 'Super_L', 'Left Super'],
  [0x0e5c, 'MetaRight', 'Super_R', 'Right Super'],
  [0x0e5d, 'ContextMenu', 'Menu', 'Menu'],

  [0xe022, 'MediaPlayPause', 'XF86AudioPlay', 'Play/Pause'],
  [0xe024, 'MediaStop', 'XF86AudioStop', 'Media Stop'],
  [0xe010, 'MediaTrackPrevious', 'XF86AudioPrev', 'Previous Track'],
  [0xe019, 'MediaTrackNext', 'XF86AudioNext', 'Next Track'],
  [0xe06d, 'MediaSelect', 'XF86AudioMedia', 'Media'],
  [0xe02c, 'Eject', 'XF86Eject', 'Eject'],
  [0xe020, 'AudioVolumeMute', 'XF86AudioMute', 'Mute'],
  [0xe030, 'AudioVolumeUp', 'XF86AudioRaiseVolume', 'Volume Up'],
  [0xe02e, 'AudioVolumeDown', 'XF86AudioLowerVolume', 'Volume Down'],
  [0xe06c, 'LaunchMail', 'XF86Mail', 'Mail'],
  [0xe021, 'LaunchApp2', 'XF86Calculator', 'Calculator'],
  [0xe03c, null, 'XF86Music', 'Music'],
  [0xe064, null, 'XF86Pictures', 'Pictures'],
  [0xe065, 'BrowserSearch', 'XF86Search', 'Search'],
  [0xe032, 'BrowserHome', 'XF86HomePage', 'Browser Home'],
  [0xe06a, 'BrowserBack', 'XF86Back', 'Browser Back'],
  [0xe069, 'BrowserForward', 'XF86Forward', 'Browser Forward'],
  [0xe068, 'BrowserStop', 'XF86Stop', 'Browser Stop'],
  [0xe067, 'BrowserRefresh', 'XF86Reload', 'Browser Reload'],
  [0xe066, 'BrowserFavorites', 'XF86Favorites', 'Favorites'],
  [0xe05e, 'Power', 'XF86PowerOff', 'Power'],
  [0xe05f, 'Sleep', 'XF86Sleep', 'Sleep'],
  [0xe063, 'WakeUp', 'XF86WakeUp', 'Wake'],

  [0x0070, 'KanaMode', 'Katakana', 'Katakana'],
  [0x007b, null, 'Hiragana', 'Hiragana'],
  [0x0079, null, 'Kanji', 'Kanji'],
  [0x007d, 'IntlYen', 'yen', '¥'],
  [0x0073, 'IntlRo', 'underscore', 'Ro'],
  [0x007e, null, 'KP_Separator', 'Numpad ,'],
];

const byCode = new Map();
const byDom = new Map();
for (const [code, dom, keysym, label] of ROWS) {
  const row = { code, keysym, label };
  if (!byCode.has(code)) byCode.set(code, row);
  if (dom && !byDom.has(dom)) byDom.set(dom, row);
}

// how the old config named its eight choices — carried forward once
const LEGACY = {
  F6: 0x0040, F7: 0x0041, F8: 0x0042, F9: 0x0043, F10: 0x0044, F12: 0x0058,
  ScrollLock: 0x0046, Pause: 0x0e45,
};

const DEFAULT = fromCode(LEGACY.F8);

// `known` says the key came out of the table above, which is what decides
// whose keysym and label survive when both channels saw the same press
function shortcut(code, keysym, label, known) {
  return { code: code || null, keysym: keysym || null, label, known: !!known };
}

// the global hook's view: a keycode, and whatever we know about it
function fromCode(code) {
  if (!code) return null; // 0 is uiohook's own "no idea what that was"
  const row = byCode.get(code);
  return row
    ? shortcut(row.code, row.keysym, row.label, true)
    : shortcut(code, null, null, false);
}

// the settings window's view: a DOM KeyboardEvent
function fromDom(domCode, domKey) {
  const row = domCode && byDom.get(domCode);
  if (row) return shortcut(row.code, row.keysym, row.label, true);
  // an unmapped key still has a name worth showing, even if nothing can
  // bind it — the hook, when it also saw the press, supplies the code
  const label =
    (domKey && domKey.length === 1 ? domKey.toUpperCase() : domKey) ||
    domCode ||
    'Unknown key';
  return shortcut(null, null, label, false);
}

// merge what the two channels saw of one press
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const named = a.known ? a : b.known ? b : a;
  return shortcut(
    a.code || b.code,
    named.keysym,
    named.label || a.label || b.label,
    named.known
  );
}

function name(sc) {
  return (sc && sc.label) || (sc && sc.code ? `Key #${sc.code}` : 'Unknown key');
}

function fromConfig(c) {
  if (c && typeof c === 'object' && Number.isInteger(c.code)) {
    // trust the table over the stored copy: a vibecheck update can teach it
    // a name for a key that had none when the shortcut was recorded
    const row = byCode.get(c.code);
    if (row) return shortcut(row.code, row.keysym, row.label, true);
    return shortcut(c.code, c.keysym, typeof c.label === 'string' ? c.label : null, false);
  }
  if (typeof c === 'string' && LEGACY[c]) return fromCode(LEGACY[c]);
  return null;
}

module.exports = { DEFAULT, fromCode, fromDom, fromConfig, merge, name };

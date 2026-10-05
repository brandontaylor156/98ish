// Help topics: the Accessories (Start > Programs > Accessories), plus Media Player and
// Magnifier. Format: see ../helpCore.js.

export const books = [{ id: "accessories", title: "Accessories", order: 30 }]

export const topics = [
  // ---- Notepad ----
  {
    id: "notepad",
    book: "accessories",
    title: "Notepad",
    summary: "Write plain notes, lists and diaries, and save them on drive C:.",
    keywords: ["text files", "notes", "writing", "find and replace", "time and date", ".LOG diary", "word wrap", "fonts in Notepad"],
    programs: ["Notepad"],
    body: [
      { img: "/assets/note.png", alt: "Notepad icon" },
      "Notepad is the simplest way to write something down: a shopping list, a note to yourself, a diary. It saves plain text (no bold or pictures; for those, use [[wordpad|WordPad]]).",
      { steps: ["Open Start > Programs > Accessories > Notepad.", "Type your text.", "Choose File > Save (or press {{Ctrl+S}}).", "Type a name, pick a folder (My Documents is a good place) and choose Save."], title: "To write and save a note:" },
      { h: "Opening a note again" },
      "Choose File > Open and pick the file, or find it in [[my-computer|My Computer]] and open it there. Text files on your desktop open in Notepad too.",
      { h: "Handy things in the menus" },
      {
        list: [
          "**Edit > Time/Date** (or {{F5}}) types the current time and date where your cursor is.",
          "**Edit > Word Wrap** keeps long lines inside the window. Turn it off to scroll sideways instead.",
          "**Edit > Set Font** picks the font and size for the whole window.",
          "**Search > Find** and **Search > Replace** look for a word, or swap one word for another everywhere at once.",
          "**File > Send To** sends your text to your phone or to another app (see [[share-phone]]).",
        ],
      },
      { tip: "Make an instant diary: type **.LOG** as the very first line and save. Every time you open that file, Notepad adds the time and date at the end, ready for a new entry." },
      "If you close Notepad with changes you haven't saved, it asks whether to save them first.",
      { keys: [["Ctrl+N", "New note"], ["Ctrl+O", "Open"], ["Ctrl+S", "Save"], ["Ctrl+F", "Find"], ["F3", "Find next"], ["Ctrl+H", "Replace"], ["F5", "Insert the time and date"], ["Ctrl+Z", "Undo"]], title: "Notepad shortcuts" },
      { open: "Notepad", label: "Open Notepad" },
    ],
    related: ["wordpad", "my-computer", "share-phone", "files-in-out"],
  },

  // ---- WordPad ----
  {
    id: "wordpad",
    book: "accessories",
    title: "WordPad",
    summary: "Write letters and documents with fonts, colors, bullets, pictures and printing.",
    keywords: ["documents", "letters", "bold", "fonts", "printing", "print preview", "rich text", "pictures in documents", "bullets"],
    programs: ["WordPad"],
    body: [
      { img: "/assets/program_icons/wordpad.svg", alt: "WordPad icon" },
      "WordPad is a little word processor. Use it for letters, stories and anything that should look nice: different fonts and sizes, bold and italic, colors, bullet lists, centered text and pictures.",
      { h: "Formatting text" },
      "Select some text, then click **Aa** on the toolbar to show the format bar (font, size, bold, italic, underline, color, alignment, bullets; WordPad remembers whether you left it showing), or choose **Format > Font** for everything at once. **Format > Paragraph** sets indents and alignment for a paragraph.",
      { h: "Adding a picture or the date" },
      {
        list: [
          "**Insert > Object** puts a picture from drive C: into your document (for example one you drew in [[paint|Paint]] or took with the [[camera|Camera]]).",
          "**Insert > Date and Time** lets you choose how the date looks, then types it in.",
        ],
      },
      { h: "Saving and printing" },
      "File > Save keeps your document on drive C:. When you save, you can choose Rich Text Format (keeps all the formatting) or Text Document (plain words only). **File > Print Preview** shows the pages first, and **File > Print** sends it to your printer through the browser's print window, where you can also save it as a PDF.",
      { note: "Pages are Letter size with 1-inch margins at the top and bottom. Your browser's print window can change the paper and margins." },
      "**File > Send To** sends the document to your phone or another app. **View** turns the toolbar, format bar, ruler and status bar on or off.",
      { phone: "On a phone the toolbar keeps New, Open, Save, Print, Find, Undo and Aa. Print Preview, Cut, Copy, Paste and Date/Time are in the File, Edit and Insert menus." },
      { keys: [["Ctrl+N", "New document"], ["Ctrl+O", "Open"], ["Ctrl+S", "Save"], ["Ctrl+P", "Print"], ["Ctrl+Z / Ctrl+Y", "Undo / Redo"], ["Ctrl+B / I / U", "Bold / Italic / Underline"], ["Ctrl+L / E / R", "Align left / center / right"], ["Ctrl+F", "Find"], ["F3", "Find next"], ["Ctrl+H", "Replace"]], title: "WordPad shortcuts" },
      { open: "WordPad", label: "Open WordPad" },
    ],
    related: ["notepad", "paint", "share-phone", "fonts"],
  },

  // ---- Paint ----
  {
    id: "paint",
    book: "accessories",
    title: "Paint",
    summary: "Draw and edit pictures with the classic tools, then save them or make them your wallpaper.",
    keywords: ["drawing", "pictures", "brush", "fill", "colors", "set as wallpaper", "mspaint", "flip and rotate", "edit a photo"],
    programs: ["Paint"],
    body: [
      { img: "/assets/program_icons/paint.svg", alt: "Paint icon" },
      "Paint is the classic drawing program. Pick a tool from the tool box on the left, pick a color from the color box at the bottom, and draw.",
      { h: "The tools" },
      {
        list: [
          "**Pencil** and **Brush** draw freehand; **Airbrush** sprays.",
          "**Line**, **Curve**, **Rectangle**, **Polygon**, **Ellipse** and **Rounded Rectangle** draw shapes. The options under the tool box choose outline, filled, or both.",
          "**Fill With Color** pours paint into an area. **Pick Color** grabs a color from your picture.",
          "**Eraser** rubs out. **Text** types words onto the picture.",
          "**Select** and **Free-Form Select** pick part of the picture to move, cut, copy or delete.",
          "**Magnifier** zooms in for tiny details.",
        ],
      },
      { computer: "The left mouse button draws in the first color; the right button draws in the second color. Click a color with the left or right button to set each one.", phone: "Draw with one finger (an Apple Pencil works too). Use two fingers to scroll around a big picture." },
      { h: "Saving and sharing" },
      "File > Save keeps the picture on drive C: as a PNG. **File > Set As Wallpaper** puts it on your desktop (tiled, centered or stretched), and **File > Send To** sends it to your phone or another app.",
      "The **Image** menu can flip or rotate, stretch, invert the colors, change the picture's size (Attributes) or clear it.",
      { tip: "To touch up a photo, find it in My Pictures, right-click it (or touch and hold on a phone) and choose **Edit**. Opening a picture normally shows it in [[photos|Photos]] instead." },
      { keys: [["Ctrl+N", "New picture"], ["Ctrl+O", "Open"], ["Ctrl+S", "Save"], ["Ctrl+Z", "Undo"], ["Ctrl+Y", "Repeat"], ["Ctrl+A", "Select all"], ["Ctrl+R", "Flip/Rotate"], ["Ctrl+E", "Attributes (picture size)"], ["Ctrl+I", "Invert colors"], ["Ctrl+PgUp / Ctrl+PgDn", "Normal size / Large size"], ["Ctrl+G", "Show grid (when zoomed in)"]], title: "Paint shortcuts" },
      { open: "Paint", label: "Open Paint" },
    ],
    related: ["photos", "display", "wordpad", "share-phone"],
  },

  // ---- Sound Recorder ----
  {
    id: "sound-recorder",
    book: "accessories",
    title: "Sound Recorder",
    summary: "Record your voice, add echo or play it backwards, and save it as a sound file.",
    keywords: ["recording", "microphone", "voice", "echo", "reverse", "wave sound", "audio"],
    programs: ["Sound Recorder"],
    body: [
      { img: "/assets/program_icons/recorder.svg", alt: "Sound Recorder icon" },
      "Sound Recorder records from your microphone, up to 60 seconds at a time, and lets you play with the sound.",
      { steps: ["Open Start > Programs > Entertainment > Sound Recorder.", "Press the red **Record** button. The first time, your browser asks to use the microphone: allow it.", "Speak, sing or make noises.", "Press **Stop**, then **Play** to hear it.", "Choose File > Save As to keep it on drive C:."], title: "To record a sound:" },
      { h: "Fun with effects" },
      "The **Effects** menu can make the sound louder or quieter, faster or slower, add an echo, or **Reverse** it so it plays backwards. You can apply them more than once.",
      { h: "Editing" },
      {
        list: [
          "Drag the slider to a spot, then use **Edit > Delete Before Current Position** or **Delete After Current Position** to trim.",
          "**Edit > Insert File** and **Mix with File** combine another saved sound with this one.",
          "**Edit > Insert Chime** adds a little chime.",
          "**File > Revert** goes back to the last saved version.",
        ],
      },
      "**File > Send To** sends the sound to your phone or another app.",
      { note: "On an iPhone, sound only plays after you've tapped something on the page. If you hear nothing, see [[no-sound]]." },
      { open: "Sound Recorder", label: "Open Sound Recorder" },
    ],
    related: ["media-player", "no-sound", "sounds", "share-phone"],
  },

  // ---- Calculator ----
  {
    id: "calculator",
    book: "accessories",
    title: "Calculator",
    summary: "Do sums in the Standard view, or trig, powers, statistics and binary in Scientific.",
    keywords: ["math", "sums", "calc", "scientific", "hex and binary", "memory", "statistics"],
    programs: ["Calculator"],
    body: [
      { img: "/assets/program_icons/calc.svg", alt: "Calculator icon" },
      "Calculator works like a pocket calculator. Click or tap the buttons, or type numbers and symbols on your keyboard.",
      { h: "Two views" },
      {
        list: [
          "**View > Standard**: everyday sums. It works left to right, like a simple calculator: 2 + 3 * 4 = 20.",
          "**View > Scientific**: adds sine, cosine, powers, logs, factorials, parentheses and statistics. It follows math order: 2 + 3 * 4 = 14. It also counts in hex, octal and binary.",
        ],
      },
      "**View > Digit grouping** puts commas in big numbers. **Edit > Copy** and **Paste** move numbers in and out.",
      "The memory buttons work as always: **MS** stores the number on the screen, **MR** brings it back, **M+** adds to it and **MC** clears it.",
      { keys: [["Esc", "C (clear)"], ["Del", "CE (clear entry)"], ["Enter or =", "Equals"], ["F9", "Change sign (+/-)"], ["@", "Square root"], ["r", "1/x"], ["Ctrl+M / R / L / P", "MS / MR / MC / M+"], ["s, o, t", "sin, cos, tan (Scientific)"], ["F5 F6 F7 F8", "Hex, Dec, Oct, Bin (Scientific)"], ["Ctrl+S", "Statistics box (Scientific)"]], title: "Keyboard keys" },
      { tip: "Help > Calculator Keys inside Calculator has the full list of keys." },
      { open: "Calculator", label: "Open Calculator" },
    ],
    related: ["character-map", "notepad"],
  },

  // ---- Character Map ----
  {
    id: "character-map",
    book: "accessories",
    title: "Character Map",
    summary: "Find symbols like the copyright sign, arrows or accented letters and copy them.",
    keywords: ["symbols", "special characters", "accents", "copyright sign", "copy a symbol", "charmap", "alt codes"],
    programs: ["Character Map"],
    body: [
      { img: "/assets/program_icons/charmap.svg", alt: "Character Map icon" },
      "Character Map shows every character in a font, so you can find symbols that aren't on your keyboard: hearts, arrows, accented letters, currency signs and more.",
      { steps: ["Choose a **Font** and a **Subset** (Windows Characters, Arrows, Greek, Currency Symbols, Dingbats...).", "Press a character to see it bigger.", "Choose **Select** (or double-click it) to add it to **Characters to copy**.", "Choose **Copy**, then paste it wherever you're typing."], title: "To copy a symbol:" },
      "The status bar at the bottom shows the character's code, and for the classic Windows characters the Alt key code you can type on a Windows keyboard (like Alt+0169 for the copyright sign).",
      { open: "Character Map", label: "Open Character Map" },
    ],
    related: ["fonts", "notepad", "wordpad"],
  },

  // ---- Camera ----
  {
    id: "camera",
    book: "accessories",
    title: "Camera",
    summary: "Take photos, bursts and photo-booth strips with retro effects and frames, or record short clips.",
    keywords: ["webcam", "selfie", "photo booth", "photo strip", "effects", "frames", "self-timer", "video clips", "camera permission"],
    programs: ["Camera"],
    body: [
      { img: "/assets/program_icons/camera.svg", alt: "Camera icon" },
      "Camera uses your phone's camera or your computer's webcam. The first time, your browser asks whether 98ish may use the camera: choose **Allow**.",
      { h: "Modes" },
      {
        table: {
          head: ["Mode", "What it does"],
          rows: [
            ["Photo", "One picture."],
            ["Burst", "Five pictures in a row."],
            ["Photo Strip", "Four poses on one strip, like a mall photo booth."],
            ["Video", "A clip of up to 15 seconds, saved to your device (it's too big for drive C:)."],
          ],
        },
      },
      { h: "Effects, frames and timer" },
      "The **Effects** menu changes the look live: Sepia, Black & White, CRT Monitor, Web Safe 216, Handheld, Pixelate, VHS Tape, Fisheye, Mirror, Heat Vision, Negative and Pop Art. **Frames** adds Instant Photo, Film Strip, 98ish Window, Camcorder, Hearts, Sparkles, Party Time or Gold Frame. The timer button counts down 3 or 10 seconds before the shot.",
      { phone: "Tap the big shutter button. The button beside it (or **Options > Switch Camera**) flips between the front and back cameras.", computer: "Click the shutter button or press {{Space}} or {{Enter}}. **Options** also has Mirror Front Camera, Shutter Sound and Record Sound in Clips." },
      "The modes, the timer button and the **Effects** button are under **More options »** above the shutter; its line says the mode, timer and effect you have now. The **Mode**, **Effects**, **Frames** and **Options** menus have them all too.",
      { h: "Where your photos go" },
      "Photos are saved as JPEGs in **C:\\My Pictures**. The status bar shows how much room is left. **File > Open Last Photo** shows it in [[photos|Photos]], and **File > Send Last Photo To** sends it to your phone or another app.",
      { note: "On an iPhone, video clips record the plain camera, without effects or frames." },
      { h: "If the camera doesn't show up" },
      {
        list: [
          "**Camera access is blocked**: on iPhone, tap **aA** in Safari's address bar > Website Settings > Camera > Allow, then tap Try Again. On a computer, click the camera icon in the address bar and choose Allow.",
          "**The camera is busy**: another app or tab is using it. Close that, then try again.",
          "No camera at all? **File > Picture from Your Device** lets you pick a photo instead.",
        ],
      },
      { open: "Camera", label: "Open Camera" },
    ],
    related: ["photos", "storage", "share-phone", "file-sync"],
  },

  // ---- Photos ----
  {
    id: "photos",
    book: "accessories",
    title: "Photos",
    summary: "Look through your pictures, zoom, crop and add effects, play slideshows and share.",
    keywords: ["pictures", "viewer", "slideshow", "crop", "rotate", "zoom", "wallpaper from a photo", "upload photos", "HEIC"],
    programs: ["Photos"],
    body: [
      { img: "/assets/program_icons/photos.svg", alt: "Photos icon" },
      "Photos shows the pictures on drive C:, starting with **My Pictures**. Opening any picture anywhere in 98ish opens it here.",
      { h: "Looking at pictures" },
      { phone: "Tap a picture to open it. Swipe left or right for the next one. Pinch or double-tap to zoom.", computer: "Double-click a picture to open it. Use the arrow keys for the next one, and the mouse wheel or the + and - keys to zoom (0 fits it back on screen). Esc goes back to the thumbnails." },
      { h: "Editing" },
      "The **Edit »** button on the toolbar shows the editing buttons (zoom, rotate, crop, adjust, effects and Undo), and Photos remembers whether you left them showing. The **Edit** menu has them too: **Rotate Left** or **Right**, **Crop** (free, square, 4:3, 3:4 or 16:9), adjust **Brightness/Contrast**, and add **Effects and Frames** like the ones in [[camera|Camera]]. **Undo** steps back. Nothing changes on the drive until you choose **File > Save** (replace the picture) or **Save As Copy** (keep the original). **Revert** throws your changes away.",
      { h: "Slideshows" },
      "Choose **View > Slideshow** (or press {{F5}}) to show the pictures full screen. You can pick a transition (Fade, Slide, Zoom, Wipe, Iris or Random) and a speed. Space pauses; Esc ends it.",
      { h: "Sharing" },
      {
        list: [
          "**Share > Set as Wallpaper** puts the picture on your desktop.",
          "**Open in Paint** to draw on it, **Use in Photo Puzzle** to turn it into a jigsaw.",
          "**Send by 98ish Mail** or **Send to Network Neighborhood**.",
          "**Send to My Phone** or **Download to Your Device** to save it on your real phone or computer.",
        ],
      },
      { h: "Bringing photos in" },
      "**File > Upload from Your Device** adds pictures from your phone or computer to the folder you're in.",
      { tip: "iPhone photos are sometimes in a format called HEIC that some browsers can't open. Picking them from your Photos library in Safari usually turns them into JPEGs on the way. Or on the iPhone set Settings > Camera > Formats to **Most Compatible**." },
      "**File > Delete** sends a picture to the [[recycle-bin|Recycle Bin]].",
      { open: "Photos", label: "Open Photos" },
    ],
    related: ["camera", "paint", "photo-puzzle", "files-in-out", "storage", "display"],
  },

  // ---- Address Book ----
  {
    id: "address-book",
    book: "accessories",
    title: "Address Book",
    summary: "Keep everyone you know: screen names, phones, e-mail, birthdays and pictures.",
    keywords: ["contacts", "people", "phone numbers", "birthdays", "vCard", "import contacts", "groups", "favorites", "wab"],
    programs: ["Address Book"],
    body: [
      { img: "/assets/program_icons/addressbook.svg", alt: "Address Book icon" },
      "The Address Book holds a card for each person: their name and picture, 98 Messenger screen name, 98ish Mail address, phone numbers, e-mail, address, birthday, anniversary and notes.",
      { steps: ["Open Start > Programs > Accessories > Address Book.", "Choose **File > New Contact** (**+ New** on a phone).", "Type their name, phone and e-mail, and choose OK."], title: "To add someone:" },
      "A nickname, company, screen name, 98ish Mail address and Favorite are under **More options »** on the Name tab. More phone numbers and e-mail addresses, the home address, birthday, groups and notes are on the other tabs.",
      { h: "What a card can do" },
      "Open a card to **Send IM**, **Call** them on 98 Messenger or **Send Mail**. **More »** has **Video Call**, **Invite to Calendar**, Favorite and Delete. A colored dot shows whether they're on 98 Messenger right now (green means on).",
      {
        list: [
          "**Favorites** and **groups** (File > New Group) help sort people. Pick a folder on the left to see just those.",
          "Your 98 Messenger buddies show up in **98 Messenger Buddies**, ready to add.",
          "Give someone a **birthday** and it appears every year on Calendar's **Birthdays** calendar, with a reminder that morning.",
          "Type in the search box (Edit > Find People) to find someone fast.",
        ],
      },
      { h: "Bringing contacts from your phone" },
      { steps: ["In the iPhone Contacts app, tap a person.", "Tap **Share Contact**, then **Save to Files**.", "In the Address Book choose **File > Import vCard from this Device** and pick the file."], title: "On an iPhone:" },
      { tip: "To bring lots of people at once on an iPhone (iOS 16 or later): in Contacts tap Lists, touch and hold a list and choose Export. On Android, **File > Import from Phone Contacts** can pick contacts directly in Chrome." },
      "**File > Export All** saves everyone as a .vcf file you can open on your phone or in another address book.",
      { h: "Sync" },
      "While you're signed on to 98 Messenger, your contacts are saved with your account, so they follow you to your other devices. **View > Sync Now** syncs right away.",
      { open: "Address Book", label: "Open Address Book" },
    ],
    related: ["messenger", "mail", "calendar", "search", "messenger-calls"],
  },

  // ---- Notes ----
  {
    id: "notes",
    book: "accessories",
    title: "Notes (sticky notes)",
    summary: "Jot sticky notes with checklists, pin them to the desktop, and find them from the Start menu.",
    keywords: ["sticky notes", "stickies", "post-it", "notes", "checklist", "lists", "grocery list", "pin to desktop", "recycle bin for notes", "note colors"],
    programs: ["Notes"],
    body: [
      { img: "/assets/program_icons/notes.svg", alt: "Notes icon" },
      "Notes are little sticky notes: a title, some words, and a checklist if you want one. They save as you type.",
      { steps: ["Open Start > Programs > Accessories > Notes (or the Notes icon on the desktop).", "Choose **New note**.", "Type a title and your words. Choose **+ Add a checklist** for a list you can tick off."], title: "To write a note:" },
      { h: "Checklists" },
      {
        list: [
          "Tick an item's box when it's done. Press {{Enter}} in an item to add the next one; {{Backspace}} in an empty item removes it.",
          "Drag the dotted grip on the left of an item to move it (with a mouse or a finger). From the keyboard: {{Alt+Up}} and {{Alt+Down}}.",
          "**More options »** under the note has **Move checked to bottom**, **Uncheck all** and **Remove checked**, the note's **color**, **Pin to desktop**, **Share** and **Delete**.",
        ],
      },
      { h: "On the desktop" },
      "Right-click a note (or touch and hold it) and choose **Pin to Desktop**. On a computer it becomes a sticky note on your wallpaper: drag it by its top strip, resize it from a corner, type in it and tick its list right there. Double-click the strip to open it in Notes; the × unpins it.",
      { phone: "On a phone, pinned notes wait in the small **Notes** button in the bottom corner of the desktop. Tap it to see them, and tap one to open it." },
      { h: "Finding and sorting" },
      "Type in the search box at the top of Notes, or in the Start menu's search box (notes show under **Notes**). **View > Sort By** sorts by the date changed, pinned first, or color.",
      { h: "Deleting" },
      "Deleted notes go to **View > Recycle Bin** for 30 days, where **Restore** brings them back. After 30 days (or **Delete Now**, or **Empty Recycle Bin**) they're gone for good.",
      { h: "Where notes are kept" },
      "Without an account, notes are kept **only on this device** (Notes says so). Sign on to 98 Messenger and they're saved with your screen name too, so they follow you to your other devices and you can share them (see [[notes-sharing]]). Notes made while signed off go up the next time you sign on.",
      { tip: "Pinned notes are pinned on this device only, so your phone and your computer can each pin different notes." },
      { open: "Notes", label: "Open Notes" },
    ],
    related: ["notes-sharing", "tasks", "notepad", "search"],
  },
  {
    id: "notes-sharing",
    book: "accessories",
    title: "Sharing a note with a buddy",
    summary: "Make a grocery list or date ideas you both edit, live.",
    keywords: ["shared note", "share a note", "shared list", "grocery list together", "date ideas", "our notes", "stop sharing", "leave a note"],
    body: [
      "A shared note belongs to everyone in it: you all see the same note and can change it, and changes show up for everyone right away. You need to be signed on to [[messenger|98 Messenger]].",
      { steps: ["Open the note and choose **Share...** at the top.", "Type your buddy's screen name (your buddies are suggested) and choose **Share**.", "They get a notification, and the note appears in their Notes, marked **Shared with** you."], title: "To share a note:" },
      {
        list: [
          "Each checklist item is kept on its own, so if you tick \"milk\" while your partner adds \"eggs\", both changes stay. If two people change the very same thing, the newest change wins.",
          "**View > Shared Notes** shows only shared notes.",
          "Couples: **Us > Our Notes** (or View > Us in Notes) lists the notes you share with your partner, and a new note there is shared with them right away.",
          "When a buddy changes a shared note, the Notification Center says so (and your phone too, with notifications on: see [[notifications]]).",
        ],
      },
      { h: "Stopping" },
      "The person who shared a note can **Remove** someone or **Stop sharing** in the Share window. Anyone else can **Leave**. Whoever is taken out keeps their own copy of the note. Deleting a shared note just takes you out of it (your copy goes to the Recycle Bin); the others keep it.",
      { open: "Notes", label: "Open Notes" },
    ],
    related: ["notes", "us-pairing", "messenger", "notifications"],
  },

  // ---- Tasks ----
  {
    id: "tasks",
    book: "accessories",
    title: "Tasks (to-do list)",
    summary: "A to-do list with due dates, priorities, reminders and repeats, shown in Calendar too.",
    keywords: ["tasks", "to-do", "todo list", "chores", "due date", "priority", "task reminders", "repeating tasks", "outlook tasks", "someday"],
    programs: ["Tasks"],
    body: [
      { img: "/assets/program_icons/tasks.svg", alt: "Tasks icon" },
      "Tasks opens to **Today**: what's due today, and anything overdue (in red).",
      { steps: ["Open Start > Programs > Accessories > Tasks.", "Type in the **Add a task** box and press {{Enter}}. It's due today (from the Upcoming tab, tomorrow; from Someday, no date)."], title: "To add a task:" },
      "**More options »** under the box has the rest: a due **date** and **time**, **priority** (High shows a red !), a **reminder**, a **repeat** (every day, weekday, week, month or year), which **list** it goes on, who it's **for**, and **notes**.",
      { h: "The tabs" },
      { table: { head: ["Tab", "Shows"], rows: [["Today", "Due today or overdue"], ["Upcoming", "Due after today"], ["Someday", "No due date, plus Calendar's memo lists"], ["Done", "What you've ticked lately"]] } },
      "Tick a task's box when it's done. A repeating task then shows its next time. Click a task to change it; right-click it (or touch and hold) for **Due Tomorrow**, **Priority** and **Show in Calendar**.",
      { h: "Tasks and Calendar" },
      "A task is a **to-do in Calendar**, so it shows on the calendar on its due day, and a Calendar event marked To-do shows here. The **list** is the calendar it's in: **On this device**, **My Calendar**, the couple's **Us** calendar, or a shared group calendar, where everyone in it sees the task and can tick it off.",
      { note: "Reminders work like Calendar's: a Reminder window while 98ish is open, and on your phone with notifications on (for lists on 98ish, not \"On this device\"). See [[calendar]] and [[notifications]]." },
      { open: "Tasks", label: "Open Tasks" },
    ],
    related: ["calendar", "calendar-sharing", "notes", "notifications"],
  },

  // ---- Calendar ----
  {
    id: "calendar",
    book: "accessories",
    title: "Calendar",
    summary: "Plan events with repeats and reminders in month, week, day and list views, plus memos.",
    keywords: ["events", "appointments", "reminders", "schedule", "repeating events", "memos", "birthdays calendar", "agenda"],
    programs: ["Calendar"],
    body: [
      { img: "/assets/program_icons/calendar.svg", alt: "Calendar icon" },
      "Calendar keeps your plans: dates, appointments, trips and birthdays. It also has **memos**, notes with checklists that don't need a date.",
      { steps: ["Open Start > Programs > Accessories > Calendar.", "Choose **File > New Event** (or tap a day, then the add button).", "Type a title and pick the day and the time.", "Save. That's all most events need."], title: "To add an event:" },
      "Everything else is under **More options »** at the bottom of the event, with a line that says what's set now (like \"On this device · Doesn't repeat · Reminder 15 minutes before · Auto color\"): which **calendar** it goes on, **All day**, an end on another day, a **repeat** (every day, weekday, week, month, year, or Custom), **reminders**, a **color**, the **place**, **notes**, a **checklist**, whether it's a **to-do**, and who's going. Calendar remembers whether you left More options open (see [[more-options]]).",
      { h: "Views" },
      "The **View** menu switches between **Month**, **Week**, **Day**, **List** (what's coming up) and **Memos**. **Go to Today** jumps back to now.",
      { phone: "Swipe the month or week sideways to move to the next one. Tap a day to see its events below.", computer: "Click a day to select it; double-click an empty day or hour to add an event there." },
      { h: "Your calendars" },
      {
        list: [
          "**On this device** works for anyone, even without signing on. It's kept only in this browser.",
          "**My Calendar** is yours on 98ish once you sign on to 98 Messenger, and follows you to any device.",
          "**Us** appears for couples who've paired up (see [[us-pairing]]).",
          "**Group calendars** are shared with family or friends (see [[calendar-sharing]]).",
          "**Birthdays** fills itself from birthdays in your [[address-book|Address Book]].",
        ],
      },
      { h: "Reminders" },
      "When a reminder is due, a Reminder window pops up with a chime. Choose **Dismiss**, or **Snooze** to be reminded again later.",
      { note: "Reminders from calendars on 98ish can reach your phone even when 98ish is closed, if you've turned on notifications (see [[notifications]]). **On this device** calendars only remind you while 98ish is open." },
      { tip: "On the taskbar, right-click the clock (or touch and hold it) to open Calendar or Clock." },
      { open: "Calendar", label: "Open Calendar" },
    ],
    related: ["calendar-sharing", "calendar-phone", "clock", "notifications", "address-book"],
  },

  {
    id: "calendar-sharing",
    book: "accessories",
    title: "Sharing a calendar",
    summary: "Make a group calendar and invite family or friends by screen name or an 8-letter code.",
    keywords: ["shared calendar", "group calendar", "invite code", "join a calendar", "comments on events", "family calendar", "activity"],
    body: [
      "A group calendar is shared live with the people you invite: everyone sees the same events, and changes show up for everybody right away. You need to be signed on to [[messenger|98 Messenger]], because shared calendars belong to your screen name.",
      { steps: ["In Calendar choose **File > New Calendar**.", "Give it a name and a color, and choose Create.", "In its Properties, on the **People** tab, type someone's 98 Messenger screen name and choose **Invite**.", "Or share the **invite code** (like K7QX-M2PA) or **Copy invite link** and send it to them."], title: "To start a shared calendar:" },
      { steps: ["Open Calendar and choose **File > Join a Calendar**.", "Type the 8-letter code and choose **Join**."], title: "To join with a code:" },
      "Invitations sent to your screen name show up in Calendar, where you can choose **Join** or **No thanks**.",
      { h: "Living together on a calendar" },
      {
        list: [
          "Each person has their own color, so you can tell who added what. Change yours on the People tab.",
          "Open an event to leave **Comments** about it.",
          "The **Activity** tab shows what everyone has added, changed or removed.",
          "**Labels** lets you name the colors (like \"Work\" or \"Date night\").",
        ],
      },
      "The owner can make a **New code** (the old one stops working), remove people, or delete the calendar. Anyone can **Leave**.",
      { note: "Couples already have a shared **Us** calendar once they've paired, just for the two of them. Use a group calendar for family and friends." },
      { open: "Calendar", label: "Open Calendar" },
    ],
    related: ["calendar", "calendar-phone", "us-pairing", "messenger-accounts"],
  },

  {
    id: "calendar-phone",
    book: "accessories",
    title: "Calendar on your iPhone's Calendar app",
    summary: "Subscribe to a 98ish calendar in your phone's own Calendar app, or add one event.",
    keywords: ["subscribe", "webcal", "iPhone calendar", "Google Calendar", "ics file", "add to my phone", "Remove Alerts"],
    body: [
      "You can see a 98ish calendar inside your phone's own Calendar app. Then your phone reminds you about events even when 98ish is closed.",
      { steps: ["In Calendar choose **Calendar > (the calendar's name) Properties**.", "Open the **Phone** tab and choose **Get my subscription link**.", "On your iPhone, tap **Subscribe on this phone** and confirm with Subscribe.", "Check that **Remove Alerts** is turned **off** for the subscription, so your phone keeps the reminders."], title: "To subscribe on an iPhone:" },
      { steps: ["Choose **Copy link** on the Phone tab.", "On the iPhone open **Settings > Apps > Calendar > Calendar Accounts > Add Account > Other > Add Subscribed Calendar**.", "Paste the link and tap Next, then Save."], title: "Or add it by hand:" },
      "For Google Calendar, use **Other calendars > From URL** and paste the same link.",
      { note: "The link is private to you: anyone who has it can see that calendar. If it got out, choose **New link** and the old one stops working. Phones check for changes every hour or so, and changes made in the phone's Calendar app don't come back to 98ish." },
      { h: "Just one event" },
      "Open an event and choose **Add to my phone**. It downloads a small calendar file; open it to add that event to your phone's calendar. **Share...** sends the event to another app.",
      { tip: "The **On this device** calendar can't be subscribed to, because it lives only in this browser. Its Phone tab offers a download instead, or sign on and upload its events to a calendar on 98ish." },
    ],
    related: ["calendar", "calendar-sharing", "push-setup", "home-screen"],
  },

  // ---- Clock ----
  {
    id: "clock",
    book: "accessories",
    title: "Clock",
    summary: "World clocks, alarms, a timer and a stopwatch.",
    keywords: ["alarm", "timer", "stopwatch", "world clock", "time zones", "snooze"],
    programs: ["Clock"],
    body: [
      { img: "/assets/program_icons/clock.svg", alt: "Clock icon" },
      "Clock has four tabs:",
      {
        list: [
          "**World Clock**: add cities to see what time it is for faraway friends.",
          "**Alarm**: set a time and click **Add alarm**. **More options »** adds a label and the days it repeats (weekdays unless you change them). When it rings, choose **Snooze** (9 more minutes) or stop it.",
          "**Timer**: pick a quick time (1 minute up to 1 hour) or set hours, minutes and seconds. You can pause it.",
          "**Stopwatch**: start, stop, take laps and reset.",
        ],
      },
      { note: "Alarms and the timer keep going when the Clock window is closed, but only while 98ish is open. If you close the browser tab, they won't ring." },
      "Times show in 12-hour or 24-hour style, whichever you chose in [[regional|Regional Settings]].",
      { tip: "On the taskbar, right-click the clock (or touch and hold it) to open Clock or Calendar." },
      { open: "Clock", label: "Open Clock" },
    ],
    related: ["calendar", "date-time", "regional"],
  },

  // ---- Media Player ----
  {
    id: "media-player",
    book: "accessories",
    title: "Media Player",
    summary: "Play the original songs in My Music with a light show and a playlist.",
    keywords: ["music", "songs", "MIDI", "playlist", "shuffle", "visualizer", "mplayer"],
    programs: ["Media Player"],
    body: [
      { img: "/assets/program_icons/mediaplayer.svg", alt: "Media Player icon" },
      "Media Player plays the songs in **C:\\My Music**. Every one is an original tune, made live in your browser.",
      "Press Play (it turns into Pause while a song plays), Previous or Next, or pick a song from the **Playlist** (View > Playlist). **More »** beside them shows Stop, **Shuffle**, **Repeat**, Mute and the volume, and the **Play** menu has them all too. **View** switches the light show between the **Spectrum Analyzer** and the **Oscilloscope**.",
      { keys: [["Space", "Play or pause"], ["Left / Right arrow", "Back or forward 5 seconds"], ["Up / Down arrow", "Volume up or down"]], title: "Keys" },
      "The speaker by the taskbar clock sets the volume for every sound in 98ish, Media Player included.",
      { note: "On an iPhone, check the ringer switch and tap the page once if nothing plays. See [[no-sound]]." },
      { open: "Media Player", label: "Open Media Player" },
    ],
    related: ["sound-recorder", "no-sound", "sounds"],
  },

  // ---- Magnifier ----
  {
    id: "magnifier",
    book: "accessories",
    title: "Magnifier",
    summary: "Show what's under the mouse pointer bigger, in its own window.",
    keywords: ["zoom", "bigger", "screen magnifier", "low vision", "enlarge"],
    programs: ["Magnifier"],
    body: [
      { img: "/assets/program_icons/cpl/magnifier.svg", alt: "Magnifier icon" },
      "Magnifier shows the area around your mouse pointer, enlarged, in a window you can move anywhere. Choose how much bigger with **Magnification** (2x to 6x), and whether it follows the **Mouse**, the **Keyboard focus**, or both.",
      "Web pages from other sites (like those in Internet Explorer) and videos show as gray boxes in the Magnifier.",
      { phone: "Magnifier follows a mouse, so it's for computers. On a phone, use **Larger tap targets** in [[accessibility|Accessibility Options]], or your phone's own zoom (on iPhone: Settings > Accessibility > Zoom).", computer: "Open it from Start > Programs > Accessories > Magnifier, then move the mouse around." },
      { open: "Magnifier", label: "Open Magnifier" },
    ],
    related: ["accessibility", "display", "mouse"],
  },
]

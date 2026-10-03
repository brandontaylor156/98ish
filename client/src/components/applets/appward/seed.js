// Sample data for a new Appward 98 workspace: a made-up widget maker and its made-up
// people, so every app has something in it on day one. Dates are relative to today.

import { createRecord, emptyWorkspace, link, notify, postMessage, refOf, updateRecord } from "./engine.js"

export const COWORKERS = [
  { handle: "dana", name: "Dana Whitfield", title: "Operations Manager" },
  { handle: "raj", name: "Raj Patel", title: "Sales Lead" },
  { handle: "maria", name: "Maria Gomez", title: "Quality Engineer" },
  { handle: "tom", name: "Tom Becker", title: "Shop Supervisor" },
  { handle: "lena", name: "Lena Novak", title: "HR Coordinator" },
]

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

export const newWorkspace = ({ company, me, title, sample = true, now = new Date() } = {}) => {
  const ws = emptyWorkspace({ company, me, title, users: COWORKERS })
  if (sample) seedWorkspace(ws, now)
  return ws
}

export const seedWorkspace = (ws, now = new Date()) => {
  const d = (days) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
  const me = ws.me
  const add = (app, data, by = "dana") => {
    const out = createRecord(ws, app, data, { by, quiet: true })
    if (!out.ok) throw new Error(`seed ${app}: ${JSON.stringify(out.errors || out.error)}`)
    return out.record.id
  }
  const many = (app, rows) => rows.map((r) => add(app, r))

  // places and things first: other records point at them
  const [plant, warehouse, office] = many("locations", [
    { location: "Main Plant", type: "Plant", address: "100 Sprocket Way, Springfield" },
    { location: "North Warehouse", type: "Warehouse", address: "12 Depot Rd, Springfield" },
    { location: "Front Office", type: "Office", address: "100 Sprocket Way, Suite A" },
  ])
  const [globex, initrode, vandelay, sterling] = many("companies", [
    { company: "Globex Hardware", industry: "Retail", phone: "555-0142", city: "Shelbyville", website: "globex.example", accountOwner: "raj", notes: "Our biggest retail account." },
    { company: "Initrode Supply", industry: "Distribution", phone: "555-0178", city: "Capital City", website: "initrode.example", accountOwner: "raj" },
    { company: "Vandelay Industries", industry: "Manufacturing", phone: "555-0110", city: "Ogdenville", website: "vandelay.example", accountOwner: me },
    { company: "Sterling Gadget Works", industry: "Manufacturing", phone: "555-0199", city: "North Haverbrook", accountOwner: "raj" },
  ])
  const [ann, ben, cara, dev] = many("contacts", [
    { name: "Ann Kowalski", company: globex, jobTitle: "Purchasing Manager", email: "ann@globex.example", phone: "555-0143" },
    { name: "Ben Ortiz", company: initrode, jobTitle: "Buyer", email: "ben@initrode.example", phone: "555-0179" },
    { name: "Cara Lindqvist", company: vandelay, jobTitle: "Plant Engineer", email: "cara@vandelay.example", phone: "555-0111" },
    { name: "Dev Ramaswamy", company: sterling, jobTitle: "Owner", email: "dev@sterling.example" },
  ])

  // the widget: a bill of materials that work orders consume
  const [bolt, spring, housing, gear] = many("parts", [
    { partNumber: "BLT-0420", description: "Hex bolt, 1/4 in.", type: "Raw Material", unitCost: 0.12 },
    { partNumber: "SPR-0815", description: "Compression spring", type: "Component", unitCost: 0.45 },
    { partNumber: "HSG-2000", description: "Widget housing, molded", type: "Component", unitCost: 3.1 },
    { partNumber: "GR-0032", description: "Brass gear, 32 tooth", type: "Component", unitCost: 1.85 },
  ])
  const widget = add("parts", { partNumber: "WDG-1000", description: "Deluxe Widget", type: "Finished Good", unitCost: 14.5, components: [{ part: housing, qty: 1 }, { part: gear, qty: 2 }, { part: spring, qty: 1 }, { part: bolt, qty: 4 }] })
  many("inventory", [
    { part: bolt, location: warehouse, onHand: 2400, reorderAt: 500, bin: "A-01" },
    { part: spring, location: warehouse, onHand: 380, reorderAt: 100, bin: "A-02" },
    { part: housing, location: warehouse, onHand: 140, reorderAt: 50, bin: "B-07" },
    { part: gear, location: warehouse, onHand: 260, reorderAt: 120, bin: "B-09" },
    { part: widget, location: plant, onHand: 75, reorderAt: 40, bin: "FG-1" },
  ])
  const [line1] = many("workOrderDirector", [
    { line: "Assembly Line 1", supervisor: "tom", shift: "1st", notes: "Widgets and gadgets." },
    { line: "Assembly Line 2", supervisor: "tom", shift: "2nd" },
  ])
  const [wo1, wo2] = many("workOrders", [
    { workOrder: "Deluxe Widgets for Globex", part: widget, qty: 50, status: "Released", due: d(6), location: plant, line: line1 },
    { workOrder: "Restock Deluxe Widgets", part: widget, qty: 25, status: "Planned", due: d(14), location: plant, line: line1 },
  ])
  many("drawings", [
    { drawing: "Widget housing, sheet 1", part: housing, revision: "C", drawnBy: "maria", status: "Released" },
    { drawing: "Deluxe Widget assembly", part: widget, revision: "B", drawnBy: "tom", status: "Released" },
  ])
  many("laborTracking", [{ task: "Line setup", employee: "tom", workOrder: wo1, hours: 2.5, date: d(-1) }])

  // projects with their actions (bars on the timeline) and milestones
  const [rollout, expo] = many("projects", [
    { project: "Globex Store Rollout", customer: globex, manager: "dana", start: d(-10), end: d(25), status: "Active", budget: 48000, description: "Deluxe Widget displays in 40 Globex stores." },
    { project: "Fall Trade Show", customer: "", manager: "raj", start: d(3), end: d(40), status: "Planning", budget: 12000, description: "Booth, samples and a very large inflatable widget." },
  ])
  const acts = many("actions", [
    { action: "Confirm store list with Globex", status: "Done", priority: "High", assignee: "raj", start: d(-10), due: d(-6), project: rollout },
    { action: "Build 50 display widgets", status: "In Progress", priority: "High", assignee: "tom", start: d(-4), due: d(6), project: rollout },
    { action: "Design display stand", status: "In Progress", priority: "Normal", assignee: me, start: d(-2), due: d(8), project: rollout },
    { action: "Ship displays to stores", status: "To Do", priority: "Normal", assignee: "dana", start: d(9), due: d(20), project: rollout },
    { action: "Stores open with displays", status: "To Do", priority: "Normal", assignee: "dana", start: d(25), due: d(25), project: rollout, milestone: true },
    { action: "Book trade show booth", status: "To Do", priority: "High", assignee: "raj", start: d(3), due: d(10), project: expo },
    { action: "Order inflatable widget", status: "Waiting", priority: "Low", assignee: me, start: d(5), due: d(18), project: expo },
    { action: "Trade show opens", status: "To Do", priority: "Normal", assignee: "raj", start: d(40), due: d(40), project: expo, milestone: true },
    { action: "Review safety sheets for new solvent", status: "To Do", priority: "Normal", assignee: me, due: d(2) },
  ])

  // sales
  const [lead1] = many("leads", [
    { lead: "Widgets for 12 Vandelay plants", company: vandelay, contact: cara, stage: "Proposal", value: 36000, owner: "raj", closeDate: d(21) },
    { lead: "Initrode catalog listing", company: initrode, contact: ben, stage: "Qualified", value: 15000, owner: "raj", closeDate: d(35) },
    { lead: "Sterling gear subcontract", company: sterling, contact: dev, stage: "New", value: 8000, owner: me, closeDate: d(50) },
    { lead: "Globex holiday order", company: globex, contact: ann, stage: "Negotiation", value: 52000, owner: "raj", closeDate: d(10) },
    { lead: "Spring reorder, Globex", company: globex, contact: ann, stage: "Won", value: 22000, owner: "raj", closeDate: d(-15) },
  ])
  many("installations", [{ site: "Vandelay Plant 3", customer: vandelay, installDate: d(12), technician: "tom", status: "Scheduled" }])
  many("supportContracts", [{ contract: "Globex Gold Support", customer: globex, level: "Gold", start: d(-200), end: d(165), value: 6000 }])
  many("territories", [
    { territory: "Tri-County", region: "North", rep: "raj" },
    { territory: "Coastal", region: "West", rep: me },
  ])
  const [so1] = many("salesOrders", [{ order: "Globex PO 7781", customer: globex, part: widget, qty: 50, total: 1250, shipBy: d(8), status: "In Production" }])
  many("shipping", [{ shipment: "Globex display widgets", salesOrder: so1, carrier: "Freight", tracking: "", shipDate: d(9), status: "Packing" }])
  many("deliveries", [{ delivery: "Samples to Initrode", customer: initrode, date: d(4), driver: "tom", status: "Scheduled" }])

  // help desk
  const [q1] = many("ticketDirector", [
    { queue: "Customer Support", owner: "dana", autoAssign: true, description: "Questions and complaints from customers." },
    { queue: "IT Help", owner: me, description: "Printers, passwords and the occasional Y2K question." },
  ])
  const tks = many("tickets", [
    { subject: "Widget squeaks when turned clockwise", status: "Open", priority: "High", requester: ann, assignee: "maria", queue: q1, description: "Customer reports a squeak in 3 of 40 display units." },
    { subject: "Need a copy of the invoice", status: "New", priority: "Normal", requester: ben, assignee: me, queue: q1 },
    { subject: "Printer on the 2nd floor jams", status: "Waiting", priority: "Low", requester: "", assignee: me },
    { subject: "Wrong color housings shipped", status: "Resolved", priority: "Urgent", requester: cara, assignee: "dana", queue: q1 },
  ])

  // quality
  const [prob] = many("problems", [{ problem: "Squeaky gear mesh", part: gear, severity: "High", owner: "maria", status: "Containment", rootCause: "Gear tolerance looks tight. Measuring a sample of 30." }])
  many("inspections", [
    { inspection: "First article, Deluxe Widget", part: widget, workOrder: wo1, inspector: "maria", date: d(-1), result: "Pass" },
    { inspection: "Incoming gears, lot 88", part: gear, inspector: "maria", date: d(0), result: "Pending" },
  ])
  many("audits", [{ audit: "Quarterly 5S walk", area: "Main Plant", auditor: "maria", date: d(5), result: "Scheduled" }])
  many("certifications", [{ certification: "Forklift operator", holder: "tom", issued: d(-300), expires: d(65) }])
  many("changes", [{ change: "Widen gear tolerance", part: gear, requestedBy: "maria", status: "Proposed", reason: "See the squeaky gear problem." }])

  // people
  const [posOps, posQe, posSales] = many("positions", [
    { title: "Operations Manager", department: "Operations", reportsTo: "President" },
    { title: "Quality Engineer", department: "Quality", reportsTo: "Operations Manager" },
    { title: "Sales Lead", department: "Sales", reportsTo: "President" },
  ])
  many("employees", [
    { name: "Dana Whitfield", position: posOps, department: "Operations", email: "dana@acme.example", hireDate: d(-2100) },
    { name: "Maria Gomez", position: posQe, department: "Quality", email: "maria@acme.example", hireDate: d(-900), manager: "dana" },
    { name: "Raj Patel", position: posSales, department: "Sales", email: "raj@acme.example", hireDate: d(-1500) },
    { name: "Tom Becker", department: "Manufacturing", email: "tom@acme.example", hireDate: d(-3000), manager: "dana" },
    { name: "Lena Novak", department: "HR", email: "lena@acme.example", hireDate: d(-600) },
  ])
  many("recruiting", [
    { candidate: "Pat Quinn", position: posQe, stage: "Interview", email: "pat@example.com" },
    { candidate: "Sam Okafor", position: posSales, stage: "Phone Screen" },
    { candidate: "Jo Brennan", position: posSales, stage: "Applied" },
  ])
  many("timeOff", [
    { reason: "Family reunion", employee: "tom", type: "Vacation", from: d(15), to: d(19), days: 5, status: "Pending" },
    { reason: "Dentist", employee: "maria", type: "Personal", from: d(3), to: d(3), days: 1, status: "Pending" },
    { reason: "Long weekend", employee: me, type: "Vacation", from: d(30), to: d(31), days: 2, status: "Approved" },
  ])
  many("expenses", [
    { description: "Mileage to Vandelay", category: "Travel", amount: 46.2, date: d(-3), submittedBy: "raj", status: "Pending" },
    { description: "Calipers", category: "Tools", amount: 89.99, date: d(-6), submittedBy: "maria", status: "Pending" },
    { description: "Client lunch, Globex", category: "Meals", amount: 64.5, date: d(-12), submittedBy: "raj", status: "Approved" },
    { description: "Toner cartridges", category: "Supplies", amount: 112, date: d(-20), submittedBy: me, status: "Approved" },
  ])
  many("goals", [
    { goal: "Ship 1,000 widgets this quarter", owner: "tom", due: d(80), progress: 45, status: "On Track" },
    { goal: "Zero recordable injuries", owner: "dana", due: d(80), progress: 100, status: "On Track" },
    { goal: "Close 3 new accounts", owner: "raj", due: d(60), progress: 33, status: "At Risk" },
  ])
  const [skill] = many("skills", [
    { skill: "Lockout/Tagout", category: "Safety" },
    { skill: "Spreadsheets", category: "Software" },
  ])
  many("training", [{ course: "Lockout/Tagout refresher", employee: "tom", skill, due: d(9), status: "Assigned" }])
  many("trainingDirector", [{ program: "New hire safety", audience: "Shop Floor", courses: "Lockout/Tagout\nForklift basics\nHearing protection", status: "Active" }])
  many("reviews", [{ review: "Annual review", employee: "maria", reviewer: "dana", due: d(20), status: "Not Started" }])
  many("progressReports", [{ report: "Sales, last month", employee: "raj", period: "Last month", rating: "Exceeds", summary: "Two new accounts and a very happy Globex." }])
  many("safetyIncidents", [{ incident: "Pallet jack bumped a rack", date: d(-8), location: warehouse, severity: "Near Miss", reportedBy: "tom", status: "Closed", description: "Nobody hurt. Added floor tape." }])
  many("suggestions", [
    { suggestion: "Popcorn Fridays", submittedBy: "lena", area: "Morale", status: "Under Review" },
    { suggestion: "Label the bins in both aisles", submittedBy: "tom", area: "Quality", status: "Accepted" },
  ])
  many("surveys", [{ survey: "Break room survey", question1: "Coffee or tea?", question2: "Best snack?", question3: "Radio station?", status: "Open" }])
  many("surveyDirector", [{ campaign: "Fall pulse survey", audience: "Everyone", opens: d(7), closes: d(21), status: "Draft" }])
  many("trips", [{ trip: "Vandelay plant visit", traveler: "raj", destination: "Ogdenville", depart: d(11), return: d(12), status: "Booked" }])
  many("wages", [{ payGrade: "Grade 4", employee: "tom", rate: 24.5, effective: d(-100) }])

  // social
  many("announcements", [
    { headline: "Welcome to Appward 98!", body: "Everything we do now lives in one place. Tickets, projects, parts, time off... Click around and say hi in #general.", author: "dana", posted: d(-1), pinned: true, likes: 4 },
    { headline: "Plant picnic next month", body: "Burgers, a three-legged race and the annual forklift parade. Sign up in Special Events.", author: "lena", posted: d(-3), likes: 7 },
    { headline: "New gear supplier", body: "We're trying a second supplier for brass gears. Report anything odd to Quality.", author: "maria", posted: d(-6), likes: 2 },
  ])
  const shouts = many("shoutouts", [
    { message: "Stayed late to get the Globex samples out the door. Legend!", to: "tom", from: "raj", value: "Above & Beyond", posted: d(-1), cheers: 5 },
    { message: "Found the squeaky gear in an afternoon. Detective work!", to: "maria", from: "dana", value: "Customer First", posted: d(-2), cheers: 3 },
    { message: `Thanks for setting up our new workspace!`, to: me, from: "lena", value: "Teamwork", posted: d(0), cheers: 2 },
  ])
  const [picnic] = many("specialEvents", [{ event: "Plant picnic", date: d(28), location: plant, host: "lena", notes: "Forklift parade at noon." }])
  many("specialEventsDirector", [{ plan: "Picnic planning", event: picnic, budget: 900, status: "Planning" }])
  many("calendars", [
    { event: "Inventory count", date: d(4), time: "07:00", calendar: "Company" },
    { event: "Payday", date: d(7), calendar: "Company" },
    { event: "Team lunch", date: d(1), time: "12:00", calendar: "Team" },
  ])
  const [mtg] = many("meetings", [
    { subject: "Weekly production meeting", date: d(1), time: "09:00", durationMin: 30, location: "Conference Room B", organizer: "dana", attendees: "Tom, Maria, you", agenda: "Globex rollout\nSqueaky gears\nPicnic" },
    { subject: "Vandelay proposal review", date: d(2), time: "14:00", durationMin: 60, location: "Front Office", organizer: "raj", attendees: "Raj, Dana, you" },
  ])
  many("notes", [
    { title: "Ideas for the display stand", color: "Yellow", body: "<p><b>Stand ideas</b></p><ul><li>Spinning base?</li><li>Light-up logo</li><li>Ask Tom about sheet metal</li></ul>" },
    { title: "Phone numbers", color: "Blue", body: "<p>Gear supplier: 555-0120<br>Pizza: 555-0177</p>" },
  ])
  many("documents", [
    { title: "Widget assembly instructions", folder: "Engineering", owner: "tom", body: "<h2>Deluxe Widget assembly</h2><p>1. Seat the <b>spring</b> in the housing.</p><p>2. Press both gears onto their posts.</p><p>3. Fasten the cover with four bolts. <i>Do not overtighten.</i></p>" },
    { title: "Visitor safety rules", folder: "HR", owner: "lena", body: "<p>Safety glasses past the yellow line. Always.</p>" },
  ])
  many("articles", [{ title: "How to request time off", topic: "How-To", author: "lena", body: "<p>Open <b>Time Off</b>, click <b>New</b>, fill in your dates and save. Your manager gets a notification.</p>" }])
  many("forums", [{ topic: "Best way to clean the parts washer?", board: "Help", author: "tom", post: "The citrus stuff or the blue stuff?", replies: 3 }])
  many("boards", [{ board: "Plant improvements", owner: "dana", columns: "Ideas, Doing, Done", purpose: "Small fixes around the plant." }])
  many("whiteboards", [{ name: "Booth layout sketch", owner: "raj", ideas: "Inflatable widget in the back corner. Demo table up front." }])
  many("announcementDirector", [{ campaign: "Picnic reminders", audience: "Everyone", publishOn: d(20), expires: d(28), status: "Scheduled" }])

  // operations
  const [press] = many("assets", [
    { asset: "Molding press #2", tag: "A-0002", location: plant, status: "In Service", purchased: d(-1800), value: 85000 },
    { asset: "Forklift", tag: "A-0011", location: warehouse, status: "In Service", purchased: d(-900), value: 21000 },
  ])
  many("maintenance", [{ job: "Grease press #2", asset: press, type: "Preventive", due: d(3), technician: "tom", status: "Open" }])
  many("maintenanceDirector", [{ schedule: "Press monthly PM", asset: press, everyDays: 30, nextDue: d(3), checklist: "Grease\nCheck hydraulics\nWipe down" }])
  many("licenses", [{ license: "Drafting software", vendor: "Example Soft", seats: 3, expires: d(120), cost: 900 }])
  const [po] = many("purchaseOrders", [{ po: "Brass gears, lot 89", vendor: "Example Gear Co.", part: gear, qty: 500, total: 925, status: "Sent", orderDate: d(-2) }])
  many("receiving", [{ receipt: "Gears, partial", purchaseOrder: po, received: d(0), qty: 200, receivedBy: "tom" }])
  many("purchaseRequests", [{ request: "New torque driver", requestedBy: "tom", qty: 1, estCost: 240, status: "Pending" }])
  many("safetySheets", [{ material: "Citrus degreaser", supplier: "Example Chem", hazard: "Irritant", revised: d(-40), handling: "Gloves and goggles." }])
  many("markups", [{ markup: "Fillet radius too small", drawing: "", author: "maria", comment: "Bump to 2 mm on the housing." }])
  many("pinpoint", [{ pin: "Leaky sprinkler head", location: warehouse, grid: "C-4", note: "Drips on rainy days." }])

  // development
  many("checklistCreator", [{ checklist: "Opening the plant", owner: "tom", items: "Unlock doors\nLights on\nStart the compressor\nCoffee" }])
  many("queries", [{ query: "Open urgent tickets", table: "Tickets", criteria: "Priority is Urgent and Status is not Closed" }])
  many("scriptHub", [{ script: "Morning greeting", language: "BASIC", code: '10 PRINT "GOOD MORNING, ACME!"\n20 END', description: "Our first script. It is very good." }])
  many("tours", [{ tour: "Welcome tour", app: "Home", steps: "1. Open the App Launcher\n2. Try Search\n3. Check your notifications" }])

  // the smart set: free links between records
  link(ws, refOf("tickets", tks[0]), refOf("problems", prob))
  link(ws, refOf("tickets", tks[0]), refOf("projects", rollout))
  link(ws, refOf("leads", lead1), refOf("meetings", mtg))
  link(ws, refOf("workOrders", wo1), refOf("salesOrders", so1))
  link(ws, refOf("projects", rollout), refOf("workOrders", wo1))
  void wo2
  void office

  // conversations
  const [general, shop] = many("conversations", [
    { channel: "general", kind: "Channel", topic: "Anything and everything" },
    { channel: "shop-floor", kind: "Channel", topic: "Production chatter" },
    { channel: "sales", kind: "Channel", topic: "Deals and leads" },
  ])
  const dm = add("conversations", { channel: "Dana Whitfield", kind: "Direct", topic: "Direct message" })
  postMessage(ws, general, { from: "dana", text: "Morning, everyone! Our new workspace is live." })
  postMessage(ws, general, { from: "lena", text: "Popcorn Friday is under review. Vote early, vote often." })
  postMessage(ws, shop, { from: "tom", text: "Line 1 is set up for the Globex widgets.", attachments: [refOf("workOrders", wo1)] })
  postMessage(ws, shop, { from: "maria", text: `@${me} can you look at the squeaky gear ticket when you get a sec?`, attachments: [refOf("tickets", tks[0])] })
  postMessage(ws, dm, { from: "dana", text: "Welcome aboard! Holler if you need anything." })
  updateRecord(ws, "actions", acts[2], { status: "In Progress" }, { quiet: true })
  notify(ws, { to: me, from: "dana", kind: "assign", text: "Dana Whitfield set you as Assignee on ACT-" + acts[2] + ": Design display stand", target: { app: "actions", id: acts[2] } })
  notify(ws, { to: me, from: "lena", kind: "shoutout", text: "Lena Novak gave you a shoutout: \"Thanks for setting up our new workspace!\"", target: { app: "shoutouts", id: shouts[2] } })
  return ws
}

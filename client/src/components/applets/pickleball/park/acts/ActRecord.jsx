import React from "react"
import { fitnessOf } from "./stats.js"

// The Locker Room's record of My Park's activities (Trophies tab): your fitness from the
// workouts, and how your player shows it ("Show my gains"); tennis and hoops numbers.
export const ActRecord = ({ prefs, setPrefs }) => {
  const st = prefs.actStats || {}
  const f = fitnessOf(st)
  const t = st.tennis || {}
  const h = st.hoops || {}
  const pct = h.shots ? Math.round((100 * (h.made || 0)) / h.shots) : null
  return (
    <section className="pkActRecord" data-act="record" aria-label="Fitness and games at the venues">
      <h3>Fitness</h3>
      <p>
        <b>{f.name}</b>
        {f.next ? ` · ${f.next.left} more workout${f.next.left === 1 ? "" : "s"} to ${f.next.name}` : " · the top level"}
      </p>
      <ul>
        <li>
          {f.workouts} workout{f.workouts === 1 ? "" : "s"} · {f.reps} reps · {f.perfect} perfect
        </li>
        <li>
          {f.streakDays ? `${f.streakDays} day${f.streakDays === 1 ? "" : "s"} in a row` : "No workout today yet"}
          {f.best ? ` · best score ${f.best}` : ""}
        </li>
        {f.pumped && <li>Pumped from your last workout 💪</li>}
      </ul>
      <label className="pkActGains">
        <input type="checkbox" checked={prefs.actGains !== false} onChange={(e) => setPrefs({ actGains: e.target.checked })} data-act="gains" /> Show my gains: one build stronger after a workout, and for good once you're Fit
      </label>
      <h3>Tennis</h3>
      <p>
        {t.wins || t.losses ? `${t.wins || 0} won, ${t.losses || 0} lost` : "No matches yet"}
        {t.best ? ` · best rally ${t.best} in a row` : ""}
      </p>
      <h3>Hoops</h3>
      <p>
        {h.shots ? `${h.made || 0} of ${h.shots} (${pct}%) · ${h.swishes || 0} swish${h.swishes === 1 ? "" : "es"} · best streak ${h.streak || 0}` : "No shots yet"}
        {h.world ? ` · around the world in ${h.world}` : ""}
        {h.horseWins || h.horseLosses ? ` · H-O-R-S-E ${h.horseWins || 0}-${h.horseLosses || 0}` : ""}
      </p>
      <p className="pkLockerHint">Tennis, hoops and the gym are in My Park, at the venues that have them.</p>
    </section>
  )
}

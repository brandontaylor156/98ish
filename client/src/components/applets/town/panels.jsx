import React, { useState } from "react"
import { useFloating } from "../../../hooks/useFloating"
import * as G from "./game"
import {
  BARN_MAX_UPGRADES, COMMUNITY, DECOR, EXPANSIONS, FACTORIES, GOODS, HOUSES, MATERIALS, MAX_SLOTS, PENS, TRAIN_LEVEL,
  barnUpgradeCost, itemName, slotUpgradeCost, typeName,
} from "./data"
import { iconUrl, thumbUrl } from "./art"

// Sunny Acres' windows: the Shop, the Barn, the order board, the train, factories, land
// for sale and the level-up card. Each is a small 98-style window over the map.

export const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

export const Icon = ({ id, size = 20, className = "" }) => <img className={`twIcon ${className}`} src={iconUrl(id)} width={size} height={size} alt="" draggable={false} />

// an amount with its icon; red when you don't have enough
export const Chip = ({ id, n, have, title }) => (
  <span className={`twChip${have !== undefined && have < n ? " twShort" : ""}`} title={title || itemName(id)}>
    <Icon id={id} size={18} />
    {have !== undefined ? `${have}/${n}` : n}
  </span>
)

// drags by its title bar, even out of the window (hooks/useFloating.js); a click on the
// town behind it closes it
export const Panel = ({ title, icon, onClose, children, className = "" }) => {
  const floating = useFloating({ center: true })
  return (
    <div className="twPanelWrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={floating} className={`window twPanel ${className}`} role="dialog" aria-label={title}>
        <div className="title-bar">
          <div className="title-bar-text">
            {icon && <Icon id={icon} size={14} />} {title}
          </div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onClose}></button>
          </div>
        </div>
        <div className="twPanelBody">{children}</div>
      </div>
    </div>
  )
}

const Hurry = ({ cost, clovers, onClick, label = "Hurry" }) => (
  <button type="button" className="twBtn twHurry" disabled={clovers < cost} onClick={onClick} title={`Finish now for ${cost} clover${cost > 1 ? "s" : ""}`}>
    {label} <Icon id="clover" size={16} />
    {cost}
  </button>
)

// ---- the Shop ----
const TABS = [
  ["farm", "Farm"],
  ["factory", "Factories"],
  ["house", "Houses"],
  ["community", "Town"],
  ["decor", "Decor"],
  ["land", "Land"],
]
const shopTypes = (tab, s) =>
  tab === "farm" ? ["field", ...Object.keys(PENS)]
  : tab === "factory" ? Object.keys(FACTORIES).filter((t) => t !== "feedmill")
  : tab === "house" ? Object.keys(HOUSES)
  : tab === "community" ? Object.keys(COMMUNITY).filter((t) => t !== "townhall")
  : tab === "decor" ? Object.keys(DECOR).filter((t) => !DECOR[t].giftOnly || s?.inv?.[t])
  : []

const blurb = (type) => {
  if (type === "field") return "Grows crops. Drag across fields to plant and harvest."
  if (PENS[type]) return `${ANIMALS(type)} eat ${itemName(PENS[type].feed)} and give ${itemName(PENS[type].good)}.`
  if (FACTORIES[type]) return `Makes ${FACTORIES[type].recipes.map((r) => r.name).join(", ")}.`
  if (HOUSES[type]) return `Home for ${HOUSES[type].pop} people.`
  if (COMMUNITY[type]) return `Room for ${COMMUNITY[type].cap} more people.`
  return "Makes your town prettier."
}
const ANIMALS = (type) => PENS[type].animalName

export const ShopPanel = ({ s, tab, setTab, onBuy, onExpand, onClose }) => {
  const types = shopTypes(tab, s)
  return (
    <Panel title="Shop" icon="shop" onClose={onClose} className="twShop">
      <div className="twTabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "twTab is-on" : "twTab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="twGrid">
        {types.map((type) => {
          const o = G.offer(s, type)
          const locked = s.level < o.lvl
          return (
            <div key={type} className={`twItem${locked ? " is-locked" : ""}`} data-type={type}>
              <img className="twThumb" src={thumbUrl(type)} alt="" draggable={false} />
              <div className="twItemName">{typeName(type)}</div>
              {locked ? (
                <div className="twItemLock">
                  <Icon id="lock" size={16} /> Level {o.lvl}
                </div>
              ) : (
                <>
                  <div className="twItemInfo">{blurb(type)}</div>
                  <div className="twCost">
                    {o.coins > 0 && <Chip id="coin" n={o.coins} />}
                    {o.coins === 0 && !!DECOR[type] && <span className="twFree">Free</span>}
                    {Object.entries(o.mats).map(([k, n]) => (
                      <Chip key={k} id={k} n={n} have={G.have(s, k)} />
                    ))}
                    {o.pop > 0 && <Chip id="people" n={o.pop} title="People needed in town" />}
                  </div>
                  {o.gift > 0 && <div className="twGiftTag">A gift ×{o.gift}</div>}
                  {!o.gift && DECOR[type]?.couple && <div className="twGiftTag">♥ For couples</div>}
                  {o.why && <div className="twWhy">{o.why}</div>}
                  <button type="button" className="twBtn twBuy" disabled={!!o.why} onClick={() => onBuy(type)}>
                    {o.gift ? "Place" : "Build"}
                  </button>
                </>
              )}
            </div>
          )
        })}
        {tab === "land" &&
          EXPANSIONS.map((e, k) => {
            const o = G.expansionOffer(s, k)
            const owned = !!s.exp[k]
            return (
              <div key={k} className={`twItem${s.level < e.lvl ? " is-locked" : ""}`}>
                <img className="twThumb" src={thumbUrl("saleSign")} alt="" draggable={false} />
                <div className="twItemName">{e.name}</div>
                {owned ? (
                  <div className="twItemInfo">
                    <Icon id="check" size={16} /> Yours!
                  </div>
                ) : (
                  <>
                    <div className="twCost">
                      <Chip id="coin" n={e.coins} />
                      <Chip id="shovel" n={e.shovel} have={G.have(s, "shovel")} />
                    </div>
                    {o.why && <div className="twWhy">{o.why}</div>}
                    <button type="button" className="twBtn twBuy" disabled={!!o.why} onClick={() => onExpand(k)}>
                      Clear land
                    </button>
                  </>
                )}
              </div>
            )
          })}
      </div>
    </Panel>
  )
}

// ---- the Barn ----
export const BarnPanel = ({ s, onSell, onUpgrade, onClose }) => {
  const [sel, setSel] = useState(null)
  const goods = Object.keys(GOODS).filter((g) => s.goods[g])
  const mats = Object.keys(MATERIALS)
  const cap = G.barnCap(s)
  const used = G.barnUsed(s)
  const up = s.barnUps < BARN_MAX_UPGRADES ? barnUpgradeCost(s.barnUps + 1) : null
  return (
    <Panel title="Barn" icon="barn" onClose={onClose} className="twBarn">
      <div className="twCap">
        <div className="twCapBar">
          <div style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} className={used >= cap ? "is-full" : ""} />
        </div>
        <b>
          {used} / {cap}
        </b>
      </div>
      {goods.length === 0 && <p className="twEmpty">Your Barn is empty. Harvest some crops!</p>}
      <div className="twGoods">
        {goods.map((g) => (
          <button key={g} type="button" className={`twGood${sel === g ? " is-on" : ""}`} onClick={() => setSel(sel === g ? null : g)} title={itemName(g)}>
            <Icon id={g} size={30} />
            <span>{s.goods[g]}</span>
          </button>
        ))}
      </div>
      {sel && s.goods[sel] > 0 && (
        <div className="twSell">
          <Icon id={sel} size={24} /> <b>{itemName(sel)}</b> sells for <Chip id="coin" n={GOODS[sel].price} />
          <button type="button" className="twBtn" onClick={() => onSell(sel, 1)}>
            Sell 1
          </button>
          {s.goods[sel] > 1 && (
            <button type="button" className="twBtn" onClick={() => onSell(sel, s.goods[sel])}>
              Sell all
            </button>
          )}
        </div>
      )}
      <h4 className="twH">Tools and materials</h4>
      <div className="twGoods">
        {mats.map((m) => (
          <div key={m} className="twGood is-static" title={itemName(m)}>
            <Icon id={m} size={30} />
            <span>{s.mats[m] || 0}</span>
          </div>
        ))}
      </div>
      <div className="twFoot">
        {up ? (
          <>
            <span>Upgrade to {cap + 25}:</span>
            <Chip id="coin" n={up.coins} />
            <Chip id="hammer" n={up.hammer} have={G.have(s, "hammer")} />
            <button type="button" className="twBtn" onClick={onUpgrade} disabled={s.coins < up.coins || G.have(s, "hammer") < up.hammer}>
              Upgrade
            </button>
          </>
        ) : (
          <span>Your Barn is as big as it gets!</span>
        )}
      </div>
    </Panel>
  )
}

// ---- the order board ----
// help: { requests, onAsk(kind, slot), onCancel(request) } when signed in (asking friends)
const HelpAsk = ({ help, kind, slot, can }) => {
  if (!help || can) return null
  const req = help.requests.find((r) => r.status === "open" && r.kind === kind && r.slot === slot)
  return req ? (
    <button type="button" className="twBtn twAsked" title="Waiting for a friend. Tap to take it back." onClick={() => help.onCancel(req)}>
      <Icon id="heart" size={14} /> Asked
    </button>
  ) : (
    <button type="button" className="twBtn twAsk" title="Ask friends to fill this from their Barn" onClick={() => help.onAsk(kind, slot)}>
      Help!
    </button>
  )
}

export const OrdersPanel = ({ s, now, onDeliver, onSkip, onHurry, onClose, tut, help }) => (
  <Panel title="Helicopter Orders" icon="heli" onClose={onClose} className="twOrders">
    <div className="twOrderGrid">
      {s.orders.map((o, i) => {
        if (!o.need) {
          const cost = G.speedUpCost(s, { order: i }, now)
          return (
            <div key={i} className="twOrder is-wait">
              <Icon id="heli" size={40} />
              <div>New order in {fmtTime(o.wait - now)}</div>
              {cost > 0 && <Hurry cost={cost} clovers={s.clovers} onClick={() => onHurry(i)} />}
            </div>
          )
        }
        const can = G.canDeliver(s, i)
        return (
          <div key={i} className={`twOrder${can ? " is-ready" : ""}${tut && i === 0 ? " twPulse" : ""}`} data-order={i}>
            <div className="twNeeds">
              {Object.entries(o.need).map(([g, n]) => (
                <div key={g} className={`twNeed${G.have(s, g) >= n ? " is-ok" : ""}`} title={itemName(g)}>
                  <Icon id={g} size={30} />
                  <span>
                    {G.have(s, g)}/{n}
                  </span>
                </div>
              ))}
            </div>
            <div className="twReward">
              <Chip id="coin" n={o.coins} />
              <Chip id="xp" n={o.xp} title="Experience" />
              {Object.entries(o.bonus || {}).map(([k, n]) => (
                <Chip key={k} id={k} n={n} />
              ))}
            </div>
            <div className="twOrderBtns">
              <button type="button" className="twBtn twGo" disabled={!can} onClick={() => onDeliver(i)}>
                Deliver
              </button>
              <HelpAsk help={help} kind="order" slot={i} can={can} />
              <button type="button" className="twBtn twTrash" aria-label="Skip this order" title="Skip this order" onClick={() => onSkip(i)}>
                ✕
              </button>
            </div>
          </div>
        )
      })}
    </div>
  </Panel>
)

// ---- the train ----
export const TrainPanel = ({ s, now, onLoad, onSend, onHurry, onClose, help }) => {
  const st = s.train
  const full = st.cars.length > 0 && st.cars.every((c) => c.d)
  const bonus = G.trainBonus(s)
  return (
    <Panel title="Train Station" icon="train" onClose={onClose} className="twTrain">
      {st.st === "locked" && <p className="twEmpty">The train starts coming at level {TRAIN_LEVEL}. It brings bricks, glass, slabs and tools for your goods.</p>}
      {st.st === "away" && (
        <div className="twAway">
          <Icon id="train" size={48} />
          <p>The train is out delivering. Back in {fmtTime(st.at - now)}.</p>
          <Hurry cost={G.speedUpCost(s, { train: true }, now)} clovers={s.clovers} onClick={onHurry} />
        </div>
      )}
      {st.st === "here" && (
        <>
          <p className="twHint">Fill a car with goods to get the material on its tag.</p>
          <div className="twCars">
            {st.cars.map((c, k) => (
              <div key={k} className={`twCar${c.d ? " is-done" : ""}`} data-car={k}>
                <div className="twCarGood">
                  <Icon id={c.g} size={34} />
                  <span>{c.d ? "Loaded" : `${G.have(s, c.g)}/${c.n}`}</span>
                </div>
                <div className="twCarTag">
                  <Icon id={c.m} size={22} />
                </div>
                {c.d ? (
                  <Icon id="check" size={26} />
                ) : (
                  <>
                    <button type="button" className="twBtn" disabled={G.have(s, c.g) < c.n} onClick={() => onLoad(k)}>
                      Load
                    </button>
                    <HelpAsk help={help} kind="car" slot={k} can={G.have(s, c.g) >= c.n} />
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="twFoot">
            {full ? (
              <span>
                All loaded! Bonus: <Chip id="coin" n={bonus.coins} /> <Chip id="xp" n={bonus.xp} /> <Chip id="clover" n={bonus.clovers} />
              </span>
            ) : (
              <span>Fill every car for a bonus.</span>
            )}
            <button type="button" className="twBtn twGo" onClick={onSend}>
              {full ? "Send off!" : "Send off early"}
            </button>
          </div>
        </>
      )}
    </Panel>
  )
}

// ---- a factory ----
export const FactoryPanel = ({ s, o, now, onMake, onCollect, onAddSlot, onHurry, onClose }) => {
  const f = FACTORIES[o.t]
  const jobs = G.factoryJobs(o, now)
  const done = jobs.filter((j) => j.done).length
  const slots = Array.from({ length: o.sl }, (_, k) => jobs[k] || null)
  const hurry = G.speedUpCost(s, { obj: o.i }, now)
  return (
    <Panel title={f.name} icon={f.recipes[0].id} onClose={onClose} className="twFactory">
      <div className="twSlots">
        {slots.map((j, k) => (
          <div key={k} className={`twSlot${j?.done ? " is-done" : j?.running ? " is-run" : ""}`}>
            {j ? <Icon id={j.g} size={30} /> : <span className="twSlotEmpty">empty</span>}
            {j?.running && <small>{fmtTime(j.e - now)}</small>}
            {j?.done && <small>Ready</small>}
          </div>
        ))}
        {o.sl < MAX_SLOTS && (
          <button type="button" className="twSlot twAddSlot" onClick={onAddSlot} disabled={s.coins < slotUpgradeCost(o.sl)} title="Add a production slot">
            +<Chip id="coin" n={slotUpgradeCost(o.sl)} />
          </button>
        )}
      </div>
      <div className="twFoot">
        {done > 0 && (
          <button type="button" className="twBtn twGo" onClick={onCollect}>
            Collect {done}
          </button>
        )}
        {hurry > 0 && <Hurry cost={hurry} clovers={s.clovers} onClick={onHurry} />}
      </div>
      <div className="twRecipes">
        {f.recipes.map((r) => {
          const locked = r.lvl > s.level
          const can = G.canMake(s, o, r.id)
          return (
            <div key={r.id} className={`twRecipe${locked ? " is-locked" : ""}`} data-recipe={r.id}>
              <Icon id={r.id} size={36} />
              <div className="twRecipeText">
                <b>{r.name}</b>
                <small>{fmtTime((s.tut < 4 && r.id === "cowfeed" ? 5 : r.time) * 1000)}</small>
              </div>
              {locked ? (
                <span className="twItemLock">
                  <Icon id="lock" size={16} /> Level {r.lvl}
                </span>
              ) : (
                <>
                  <div className="twCost">
                    {Object.entries(r.inputs).map(([k, n]) => (
                      <Chip key={k} id={k} n={n} have={G.have(s, k)} />
                    ))}
                  </div>
                  <button type="button" className="twBtn" disabled={!can.ok} title={can.ok ? "" : can.reason} onClick={() => onMake(r.id)}>
                    Make
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ---- land for sale ----
export const ExpandPanel = ({ s, k, onExpand, onClose }) => {
  const e = EXPANSIONS[k]
  const o = G.expansionOffer(s, k)
  return (
    <Panel title={e.name} icon="shovel" onClose={onClose} className="twSmall">
      <p>Clear this land to build on it.</p>
      <div className="twCost">
        <span className={s.level < e.lvl ? "twShortText" : ""}>Level {e.lvl}</span>
        <Chip id="coin" n={e.coins} />
        <Chip id="shovel" n={e.shovel} have={G.have(s, "shovel")} />
      </div>
      {o.why && <div className="twWhy">{o.why}</div>}
      <div className="twFoot">
        <button type="button" className="twBtn twGo" disabled={!!o.why} onClick={onExpand}>
          Clear land
        </button>
      </div>
    </Panel>
  )
}

// ---- level up! ----
export const LevelPanel = ({ level, gifts, unlocks, onClose }) => (
  <Panel title="Level up!" icon="xp" onClose={onClose} className="twLevel">
    <div className="twLevelBig">
      <Icon id="xp" size={56} />
      <span>{level}</span>
    </div>
    <p className="twCenter">Your town reached level {level}!</p>
    <div className="twCost twCenterRow">
      {Object.entries(gifts).map(([k, n]) => (
        <Chip key={k} id={k === "coins" ? "coin" : k === "clovers" ? "clover" : k} n={n} title={itemName(k)} />
      ))}
    </div>
    {unlocks.length > 0 && (
      <>
        <h4 className="twH">New in town</h4>
        <div className="twUnlocks">
          {unlocks.map((u) => (
            <div key={u.id + u.name} className="twUnlock">
              {GOODS[u.id] ? <Icon id={u.id} size={36} /> : u.id === "station" ? <Icon id="train" size={36} /> : u.id === "expand" ? <Icon id="shovel" size={36} /> : <img src={thumbUrl(u.id)} width={44} height={44} alt="" />}
              <small>{u.name}</small>
            </div>
          ))}
        </div>
      </>
    )}
    <div className="twFoot twCenterRow">
      <button type="button" className="twBtn twGo" onClick={onClose} autoFocus>
        Hooray!
      </button>
    </div>
  </Panel>
)

export const HelpPanel = ({ onClose }) => (
  <Panel title="How to Play" icon="wheat" onClose={onClose} className="twHelp">
    <ul className="twHelpList">
      <li>
        <b>Fields:</b> tap an empty field and pick a seed, then drag across other fields to plant them all. When crops are ripe, swipe across them to harvest.
      </li>
      <li>
        <b>Animals:</b> make feed at the Feed Mill, then swipe across a pen to feed the animals. Swipe again to collect milk, eggs or wool.
      </li>
      <li>
        <b>Factories:</b> tap one to see what it makes. Goods wait in the factory until you tap it to collect.
      </li>
      <li>
        <b>Orders:</b> the helicopter pays coins and XP for goods. Don't like an order? Skip it and a new one comes later.
      </li>
      <li>
        <b>The train</b> (level {TRAIN_LEVEL}) trades goods for bricks, glass, slabs, hammers and shovels.
      </li>
      <li>
        <b>Town:</b> houses bring people, and community buildings make room for more. New factories need enough people.
      </li>
      <li>
        <b>Getting around:</b> drag the map to look around; pinch or use the mouse wheel to zoom. Move lets you rearrange your town.
      </li>
      <li>
        Things keep growing while Sunny Acres is closed. <Icon id="clover" size={14} /> Clovers finish anything right away. You earn them by playing.
      </li>
    </ul>
  </Panel>
)


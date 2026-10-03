import React from "react"

// The full rules, in plain words (what engine/engine.js does)
const Rules = ({ onBack, onTutorial }) => (
  <div className="mdPage mdRules">
    <div className="mdPageHead">
      <h2>How to Duel</h2>
      <div className="mdPageBtns">
        {onTutorial && (
          <button type="button" onClick={onTutorial}>
            Play the Tutorial
          </button>
        )}
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
    <div className="mdRulesText">
      <section>
        <h3>Winning</h3>
        <p>
          Each player starts with <b>8000 Life Points</b> (online rooms can choose 4000 or 16000). Bring your opponent's LP to 0 and you win. If you have to draw a card and your Deck is empty, you lose. If both players hit 0 at the same moment, it's a draw.
        </p>
      </section>
      <section>
        <h3>Decks</h3>
        <p>
          A Deck has 30 to 60 cards (40 is the usual size), with at most 3 copies of a card. A few strong cards are <b>limited</b> to 1 copy. Fusion Monsters wait in a separate Extra Deck of up to 15 cards. You draw 5 cards to start.
        </p>
      </section>
      <section>
        <h3>A turn</h3>
        <ol>
          <li>
            <b>Draw Phase:</b> draw 1 card. The player who goes first skips this on their first turn.
          </li>
          <li>
            <b>Standby Phase:</b> some cards do something here ("During your Standby Phase...").
          </li>
          <li>
            <b>Main Phase 1:</b> summon or set a monster, activate and set Spell and Trap cards, change your monsters' positions, use effects.
          </li>
          <li>
            <b>Battle Phase:</b> attack with your monsters. The first player can't attack on the very first turn.
          </li>
          <li>
            <b>Main Phase 2:</b> the same as Main Phase 1, after your battles.
          </li>
          <li>
            <b>End Phase:</b> if you have more than 6 cards in hand, discard down to 6. Effects that last "this turn" end.
          </li>
        </ol>
      </section>
      <section>
        <h3>Monsters</h3>
        <p>
          Monsters have <b>ATK</b> and <b>DEF</b>, a <b>Level</b> (the stars), an Attribute (FIRE, WATER, EARTH, WIND, LIGHT or DARK) and a Type (Dragon, Machine, Spellcaster...). Normal Monsters have no effect, just a story; Effect Monsters do something.
        </p>
        <ul>
          <li>
            Once per turn you may <b>Normal Summon</b> a monster face-up in Attack Position, <i>or</i> <b>Set</b> one face-down in Defense Position.
          </li>
          <li>
            Level 5 and 6 monsters need <b>1 tribute</b> (send one of your monsters to the Graveyard); Level 7 and higher need <b>2</b>.
          </li>
          <li>
            A face-down monster can be <b>Flip Summoned</b> (turned face-up in Attack Position) on a later turn. Its "FLIP:" effect happens when it's turned face-up in any way, even by being attacked.
          </li>
          <li>Once per turn you may switch a monster between Attack and Defense Position, but not on the turn it arrived and not after it attacked.</li>
          <li>Card effects can <b>Special Summon</b> monsters too. That doesn't use up your Normal Summon.</li>
        </ul>
      </section>
      <section>
        <h3>Battle</h3>
        <p>Each Attack Position monster may attack once per Battle Phase. If your opponent has no monsters, attack them directly: they take the attacker's ATK as damage.</p>
        <ul>
          <li>
            <b>Against an Attack Position monster:</b> the one with lower ATK is destroyed, and its controller takes the difference. Equal ATK: both are destroyed and nobody takes damage.
          </li>
          <li>
            <b>Against a Defense Position monster:</b> if your ATK is higher than its DEF, it's destroyed, but nobody takes damage (unless your monster has a piercing effect). If your ATK is lower, you take the difference and nothing is destroyed. Equal: nothing happens.
          </li>
          <li>A face-down defender is flipped face-up when attacked, before damage is worked out.</li>
          <li>If the monster you attacked leaves the field before damage, the attack is cancelled and your monster may attack again.</li>
        </ul>
      </section>
      <section>
        <h3>Spells and Traps</h3>
        <ul>
          <li>
            <b>Spell cards</b> are played from your hand in your Main Phase (or set face-down to use later). <b>Normal</b> Spells resolve and go to the Graveyard. <b>Continuous</b> Spells stay and keep working. <b>Equip</b> Spells attach to a monster. <b>Field</b> Spells sit in the Field Zone and change the whole table. <b>Quick-Play</b> Spells can also be used in answer to other cards on your turn, and on your opponent's turn if you set them earlier.
          </li>
          <li>
            <b>Trap cards</b> must be set first, and can be activated from your opponent's next turn onward, at the right moment: some say "When an opponent's monster declares an attack", some "When your opponent Summons". <b>Continuous</b> Traps stay on the field. <b>Counter</b> Traps answer another card's activation, and only another Counter Trap can answer them.
          </li>
        </ul>
      </section>
      <section>
        <h3>Chains</h3>
        <p>
          When a card is activated, the other player gets a chance to respond with a card of their own. Responses stack up into a <b>chain</b>, and the chain resolves backwards: the last card activated happens first. Monster effects that happen by themselves ("When this card is destroyed...") also start chains.
        </p>
        <p>
          You only get asked when you have a card that can respond. Change that in the Options menu (or the side panel): <b>Always</b> ask (good for bluffing online), ask <b>only when I can</b> respond, or <b>never</b> ask.
        </p>
      </section>
      <section>
        <h3>Controls</h3>
        <ul>
          <li>Click (or tap) a card to see what it can do, then pick from its menu. Some moves then ask you to click tributes or targets on the table.</li>
          <li>Drag a card from your hand onto your monster or spell row, or drag an attacker onto an enemy monster.</li>
          <li>Hover a card (or long-press it on a phone) to read it in full. Click a Graveyard to look through it.</li>
          <li>The phase buttons in the middle move you to the Battle Phase, Main Phase 2 and the end of your turn.</li>
        </ul>
      </section>
      <section>
        <h3>Collecting</h3>
        <p>You own every card in the eight starter decks from the start. Win duels against the computer to earn card packs (harder opponents give more), open them for more cards, and build your own decks in the Deck Builder.</p>
      </section>
    </div>
  </div>
)

export default Rules

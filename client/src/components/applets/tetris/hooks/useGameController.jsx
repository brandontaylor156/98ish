import { Action, actionForKey } from "../utils/InputLogic";
import { playerController } from "../utils/PlayerLogic";

import { useDropTime } from "./useDropTime";
import { useInterval } from "./useInterval";

// Keyboard handling for the focused Tetris window. Returns the handler to attach plus
// pause/resume so the window can pause itself when it loses focus.
export const useGameController = ({
  board,
  gameStats,
  player,
  setGameOver,
  setPlayer
}) => {
  const [dropTime, pauseDropTime, resumeDropTime] = useDropTime({
    gameStats
  });

  const handleInput = (action) => {
    playerController({
      action,
      board,
      player,
      setPlayer,
      setGameOver
    });
  };

  useInterval(() => {
    handleInput(Action.SlowDrop);
  }, dropTime);

  const onKeyDown = (event) => {
    const action = actionForKey(event.code);
    if (!action) return;

    // Arrows and Space would otherwise scroll the page
    event.preventDefault();

    if (action === Action.Pause) {
      if (dropTime) {
        pauseDropTime();
      } else {
        resumeDropTime();
      }
    } else if (action === Action.Quit) {
      setGameOver(true);
    } else if (dropTime) {
      handleInput(action);
    }
  };

  return {
    onKeyDown,
    paused: !dropTime,
    pause: pauseDropTime,
    resume: resumeDropTime
  };
};

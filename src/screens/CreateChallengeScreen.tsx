import { useRef, useState } from "react";
import type { FormEvent } from "react";
import AppHeader from "../components/AppHeader";
import Button from "../components/Button";
import DrawingCanvas, { type DrawingCanvasHandle } from "../components/DrawingCanvas";
import PenColorMenu from "../components/PenColorMenu";
import { CANVAS_SIZE, MIN_POINTS_TO_SAVE, type PenColorId } from "../app/constants";
import { saveChallenge } from "../services/challengeStorage";
import { getSelectedColor, setSelectedColor } from "../services/penColorStore";
import { toAchievements, toCreate, toHome, toInstructions, toList, toSettings, toShop } from "../app/routes";
import type { Screen } from "../types/GameMode";
import type { DrawingPath } from "../types/Challenge";

type CreateChallengeScreenProps = {
  onNavigate: (screen: Screen) => void;
};

export default function CreateChallengeScreen({ onNavigate }: CreateChallengeScreenProps) {
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [name, setName] = useState("");
  const [penColor, setPenColor] = useState<PenColorId>(() => getSelectedColor());

  function handleSelectPenColor(id: PenColorId) {
    setSelectedColor(id);
    setPenColor(id);
  }

  function handleLockedColorClick() {
    onNavigate(toShop(toCreate()));
  }

  function handleClear() {
    canvasRef.current?.clear();
    setCurrentPath(null);
    setError(null);
    setNamePromptOpen(false);
  }

  function handleUndo() {
    canvasRef.current?.undoLastStroke();
  }

  function handleSaveClick() {
    if (!currentPath || currentPath.points.length < MIN_POINTS_TO_SAVE) {
      setError("Draw a longer shape first.");
      return;
    }
    setError(null);
    setNamePromptOpen(true);
  }

  function handleConfirmSave(event: FormEvent) {
    event.preventDefault();
    if (!currentPath || !name.trim()) return;

    saveChallenge({
      id: crypto.randomUUID(),
      name: name.trim(),
      target: currentPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
    });

    onNavigate(toList());
  }

  return (
    <div className="screen">
      <AppHeader
        title="Create Challenge"
        onBack={() => onNavigate(toHome())}
        onNavigateToAchievements={() => onNavigate(toAchievements(toCreate()))}
        onNavigateToInstructions={() => onNavigate(toInstructions(toCreate()))}
        onNavigateToShop={() => onNavigate(toShop(toCreate()))}
        onNavigateToHome={() => onNavigate(toHome())}
        onNavigateToSettings={() => onNavigate(toSettings())}
      />
      <p className="status-text">Draw any shape</p>
      <div className="canvas-wrapper">
        <DrawingCanvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          strokeColor={penColor}
          onChange={setCurrentPath}
        />
      </div>
      <PenColorMenu selected={penColor} onSelect={handleSelectPenColor} onLockedColorClick={handleLockedColorClick} />
      {error && <p className="form-error">{error}</p>}
      {!namePromptOpen && (
        <div className="button-row">
          <Button variant="secondary" onClick={handleUndo} disabled={!currentPath || currentPath.points.length === 0}>
            Undo
          </Button>
          <Button variant="secondary" onClick={handleClear}>
            Clear
          </Button>
          <Button onClick={handleSaveClick}>Save Challenge</Button>
        </div>
      )}
      {namePromptOpen && (
        <form className="name-form" onSubmit={handleConfirmSave}>
          <input autoFocus placeholder="Challenge name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="button-row">
            <Button type="button" variant="secondary" onClick={() => setNamePromptOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Confirm
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

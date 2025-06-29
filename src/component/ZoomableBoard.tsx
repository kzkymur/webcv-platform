import React, { ReactNode, useCallback, useRef, useState } from "react";
import styled from "styled-components";
import { useStore } from "@/module/useStore";
import { keys } from "@/node/Node";

interface ZoomableBoardProps {
  children: ReactNode;
}

const BoardContainer = styled.div<{ $isDragging: boolean }>`
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: ${props => props.$isDragging ? 'grabbing' : 'grab'};
  position: relative;
`;

const ZoomableContent = styled.div<{
  $zoomLevel: number;
  $offsetX: number;
  $offsetY: number;
  $isDragging: boolean;
}>`
  transform: scale(${props => props.$zoomLevel}) translate(${props => props.$offsetX}px, ${props => props.$offsetY}px);
  transform-origin: 0 0;
  width: 100%;
  height: 100%;
  pointer-events: ${props => props.$isDragging ? 'none' : 'auto'};
`;

const ZoomableBoard: React.FC<ZoomableBoardProps> = ({ children }) => {
  const [zoomLevel, setZoomLevel] = useStore<number>(keys.zoomLevel, undefined, 1.0);
  const [boardOffset, setBoardOffset] = useStore<{ x: number, y: number }>(
    keys.boardOffset,
    undefined,
    { x: 0, y: 0 }
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragStartOffset, setDragStartOffset] = useState({ x: 0, y: 0 });

  const handleWheel = useCallback((event: React.WheelEvent) => {
    const zoomSensitivity = 0.1;
    const zoomFactor = event.deltaY > 0 ? 1 - zoomSensitivity : 1 + zoomSensitivity;

    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();

    const currentZoom = zoomLevel || 1.0;
    const currentOffset = boardOffset || { x: 0, y: 0 };

    const mouseX = (event.clientX - rect.left) / currentZoom + currentOffset.x;
    const mouseY = (event.clientY - rect.top) / currentZoom + currentOffset.y;

    const newZoomLevel = Math.max(0.1, Math.min(3.0, currentZoom * zoomFactor));

    // Calculate the point in the content that the mouse is hovering over
    const pointInContentX = (mouseX - currentOffset.x) / currentZoom;
    const pointInContentY = (mouseY - currentOffset.y) / currentZoom;

    // Calculate new offset to keep the mouse position over the same content point
    const newOffsetX = mouseX - pointInContentX * newZoomLevel;
    const newOffsetY = mouseY - pointInContentY * newZoomLevel;

    setZoomLevel(newZoomLevel);
    setBoardOffset({ x: newOffsetX, y: newOffsetY });
  }, [zoomLevel, boardOffset, setZoomLevel, setBoardOffset]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('[data-rnd]')) return;

    setIsDragging(true);
    setDragStart({ x: event.clientX, y: event.clientY });
    setDragStartOffset({ ...boardOffset! });
    event.preventDefault();
  }, [boardOffset]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isDragging) return;

    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;

    setBoardOffset({
      x: dragStartOffset.x + deltaX / (zoomLevel || 1.0),
      y: dragStartOffset.y + deltaY / (zoomLevel || 1.0),
    });
  }, [isDragging, dragStart, dragStartOffset, setBoardOffset, zoomLevel]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <BoardContainer
      ref={containerRef}
      $isDragging={isDragging}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <ZoomableContent
        $zoomLevel={zoomLevel || 10.0}
        $offsetX={boardOffset?.x || 0}
        $offsetY={boardOffset?.y || 0}
        $isDragging={isDragging}
      >
        {children}
      </ZoomableContent>
    </BoardContainer>
  );
};

export default ZoomableBoard;

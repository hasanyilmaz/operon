import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { runAsyncAction } from '../core/async-action';
import type { FlowTimeDialState } from '../systems/flow-time-dial-state';
import type { FlowTimeControls } from '../systems/flow-time-controls';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function resolveFlowTimeDialAccent(taskColor: string | undefined): string | null {
	const color = taskColor?.trim();
	if (!color) return null;
	return color.startsWith('#') ? color : `#${color}`;
}

export function createFlowTimeDial(container: HTMLElement, target: Pick<FlowTimeControls, 'begin' | 'editable'>) {
	const ownerDocument = getOwnerDocument(container);
	const svg = ownerDocument.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'operon-flow-time-dial');
	svg.setAttribute('viewBox', '0 0 240 240');
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-hidden', 'true');

	const ticks = ownerDocument.createElementNS(SVG_NS, 'g');
	ticks.setAttribute('class', 'operon-flow-time-ticks');
	for (let i = 0; i < 60; i++) {
		const major = i % 5 === 0;
		const outer = pointOnCircle(120, 120, 106, i * 6);
		const inner = pointOnCircle(120, 120, major ? 91 : 98, i * 6);
		const line = ownerDocument.createElementNS(SVG_NS, 'line');
		line.setAttribute('class', major ? 'is-major' : 'is-minor');
		line.setAttribute('x1', String(inner.x));
		line.setAttribute('y1', String(inner.y));
		line.setAttribute('x2', String(outer.x));
		line.setAttribute('y2', String(outer.y));
		ticks.appendChild(line);
	}
	svg.appendChild(ticks);

	const face = ownerDocument.createElementNS(SVG_NS, 'circle');
	face.setAttribute('class', 'operon-flow-time-face');
	face.setAttribute('cx', '120');
	face.setAttribute('cy', '120');
	face.setAttribute('r', '70');
	svg.appendChild(face);

	const wedge = ownerDocument.createElementNS(SVG_NS, 'path');
	wedge.setAttribute('class', 'operon-flow-time-wedge');
	svg.appendChild(wedge);

	const hand = ownerDocument.createElementNS(SVG_NS, 'line');
	hand.setAttribute('class', 'operon-flow-time-hand');
	hand.setAttribute('x1', '120');
	hand.setAttribute('y1', '120');
	svg.appendChild(hand);

	const hubOuter = ownerDocument.createElementNS(SVG_NS, 'circle');
	hubOuter.setAttribute('class', 'operon-flow-time-hub-outer');
	hubOuter.setAttribute('cx', '120');
	hubOuter.setAttribute('cy', '120');
	hubOuter.setAttribute('r', '21');
	svg.appendChild(hubOuter);

	const hub = ownerDocument.createElementNS(SVG_NS, 'circle');
	hub.setAttribute('class', 'operon-flow-time-hub');
	hub.setAttribute('cx', '120');
	hub.setAttribute('cy', '120');
	hub.setAttribute('r', '15');
	svg.appendChild(hub);

	const drag = bindFlowTimeDialDrag(svg, container, target);
	container.appendChild(svg);

	return {
		...drag,
		update(state: FlowTimeDialState, accentColor: string | null): void {
			container.style.setProperty('--operon-flow-time-accent', accentColor ?? 'var(--interactive-accent)');
			svg.classList.toggle('is-flowtime', state.mode === 'flowtime');
			svg.classList.toggle('is-overtime', state.overtime);
			svg.classList.toggle('is-editable', target.editable);
			wedge.setAttribute('d', describeWedge(120, 120, 70, 0, state.angleDegrees, !state.overtime));
			const handEnd = pointOnCircle(120, 120, 96, state.angleDegrees);
			hand.setAttribute('x2', String(handEnd.x));
			hand.setAttribute('y2', String(handEnd.y));
		},
	};
}

export function bindFlowTimeDialDrag(svg: SVGSVGElement, container: HTMLElement, target: Pick<FlowTimeControls, 'begin'>) {
	let cancelDrag: (() => void) | undefined;

	svg.addEventListener('pointerdown', event => {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const owner = getOwnerWindow(svg);
		const rect = svg.getBoundingClientRect();
		const pointerId = event.pointerId;
		let stopMigration: (() => void) | undefined;
		const edit = target.begin(() => {
			cancelDrag = undefined;
			stopMigration?.();
			owner.removeEventListener('pointermove', move);
			owner.removeEventListener('pointerup', release);
			owner.removeEventListener('pointercancel', cancelPointer);
			owner.removeEventListener('keydown', keydown, true);
			owner.removeEventListener('blur', cancel);
			owner.removeEventListener('resize', cancel);
			svg.removeEventListener('lostpointercapture', cancelPointer);
			try {
				if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
			} catch {
				// The pointer may already be inactive or the SVG detached.
			}
		});
		if (!edit) return;

		const { initialMinutes, preview, commit, cancel } = edit;
		event.preventDefault();
		let previousAngle = getPointerAngle(event, rect);
		let accumulatedDegrees = 0;
		cancelDrag = cancel;
		try {
			svg.setPointerCapture(pointerId);
		} catch {
			// Window listeners still handle pointers that could not be captured.
		}

		function move(pointerEvent: PointerEvent): void {
			if (pointerEvent.pointerId !== pointerId) return;
			if (!svg.isConnected || getOwnerWindow(svg) !== owner) {
				cancel();
				return;
			}
			const angle = getPointerAngle(pointerEvent, rect);
			let delta = angle - previousAngle;
			if (delta > 180) delta -= 360;
			if (delta < -180) delta += 360;
			previousAngle = angle;
			accumulatedDegrees += delta;
			preview(initialMinutes + accumulatedDegrees / 6);
		}
		function release(pointerEvent: PointerEvent): void {
			if (pointerEvent.pointerId !== pointerId) return;
			move(pointerEvent);
			runAsyncAction('flow time dial save failed', commit);
		}
		function cancelPointer(pointerEvent: PointerEvent): void {
			if (pointerEvent.pointerId === pointerId) cancel();
		}
		function keydown(keyEvent: KeyboardEvent): void {
			if (keyEvent.key !== 'Escape') return;
			keyEvent.preventDefault();
			keyEvent.stopPropagation();
			cancel();
		}

		stopMigration = container.onWindowMigrated?.(cancel);
		owner.addEventListener('pointermove', move);
		owner.addEventListener('pointerup', release);
		owner.addEventListener('pointercancel', cancelPointer);
		owner.addEventListener('keydown', keydown, true);
		owner.addEventListener('blur', cancel);
		owner.addEventListener('resize', cancel);
		svg.addEventListener('lostpointercapture', cancelPointer);
	});

	return { cancelDrag: () => cancelDrag?.(), isDragging: () => !!cancelDrag };
}

function getPointerAngle(event: PointerEvent, rect: DOMRect): number {
	const x = event.clientX - rect.left - rect.width / 2;
	const y = event.clientY - rect.top - rect.height / 2;
	return (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
}

function pointOnCircle(cx: number, cy: number, radius: number, angleDegrees: number): { x: number; y: number } {
	const radians = (angleDegrees - 90) * Math.PI / 180;
	return {
		x: cx + radius * Math.cos(radians),
		y: cy + radius * Math.sin(radians),
	};
}

function describeWedge(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, clockwise: boolean): string {
	const normalizedDelta = clockwise
		? ((endAngle - startAngle) % 360 + 360) % 360
		: ((startAngle - endAngle) % 360 + 360) % 360;
	if (normalizedDelta < 0.01) {
		return `M ${cx} ${cy} L ${cx} ${cy - radius} Z`;
	}
	const adjustedEnd = normalizedDelta > 359.5
		? (clockwise ? startAngle + 359.5 : startAngle - 359.5)
		: endAngle;
	const start = pointOnCircle(cx, cy, radius, startAngle);
	const end = pointOnCircle(cx, cy, radius, adjustedEnd);
	const largeArc = normalizedDelta > 180 ? '1' : '0';
	const sweep = clockwise ? '1' : '0';
	return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y} Z`;
}

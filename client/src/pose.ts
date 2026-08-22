import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'

export interface Point {
  x: number
  y: number
}

/**
 * Creates a fresh PoseLandmarker instance. detectForVideo() requires strictly increasing
 * timestamps per instance, so the live webcam feed and the reference video feed each need
 * their own instance — never share one landmarker across two unrelated video timelines.
 */
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL)
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  })
}

const LANDMARK = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

/** Angle at vertex `b`, between rays b->a and b->c, in degrees. */
function angleAt(b: Point, a: Point, c: Point): number {
  const ab = { x: a.x - b.x, y: a.y - b.y }
  const cb = { x: c.x - b.x, y: c.y - b.y }
  const dot = ab.x * cb.x + ab.y * cb.y
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y)
  if (mag === 0) return 0
  const cos = Math.min(1, Math.max(-1, dot / mag))
  return (Math.acos(cos) * 180) / Math.PI
}

export interface JointAngles {
  leftElbow: number
  rightElbow: number
  leftKnee: number
  rightKnee: number
  leftHip: number
  rightHip: number
}

export const JOINT_LABELS: Record<keyof JointAngles, string> = {
  leftElbow: 'Left elbow',
  rightElbow: 'Right elbow',
  leftKnee: 'Left knee',
  rightKnee: 'Right knee',
  leftHip: 'Left hip',
  rightHip: 'Right hip',
}

/** Computes key joint angles from one pose's 33 landmarks, or null if any needed point is missing. */
export function computeJointAngles(landmarks: Point[]): JointAngles | null {
  const required = Object.values(LANDMARK)
  if (required.some((i) => !landmarks[i])) return null

  const get = (i: number) => landmarks[i]

  return {
    leftElbow: angleAt(get(LANDMARK.leftElbow), get(LANDMARK.leftShoulder), get(LANDMARK.leftWrist)),
    rightElbow: angleAt(get(LANDMARK.rightElbow), get(LANDMARK.rightShoulder), get(LANDMARK.rightWrist)),
    leftKnee: angleAt(get(LANDMARK.leftKnee), get(LANDMARK.leftHip), get(LANDMARK.leftAnkle)),
    rightKnee: angleAt(get(LANDMARK.rightKnee), get(LANDMARK.rightHip), get(LANDMARK.rightAnkle)),
    leftHip: angleAt(get(LANDMARK.leftHip), get(LANDMARK.leftShoulder), get(LANDMARK.leftKnee)),
    rightHip: angleAt(get(LANDMARK.rightHip), get(LANDMARK.rightShoulder), get(LANDMARK.rightKnee)),
  }
}

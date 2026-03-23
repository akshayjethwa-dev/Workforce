// app/(admin)/workers/add.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Modal, ActivityIndicator, Alert, Switch, Platform
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FaceDetector from 'expo-face-detector';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/contexts/AuthContext';
import { dbService } from '../../../src/services/db';
import { storage } from '../../../src/lib/firebase'; 
import { Worker, ShiftConfig, Branch, OrgSettings } from '../../../src/types/index';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface FaceDescriptorPayload {
  landmarks: number[];
  capturedAt: string;
}

interface DetectedFace {
  bounds: { origin: { x: number; y: number }; size: { width: number; height: number } };
  rollAngle?: number;
  yawAngle?: number;
  smilingProbability?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  LEFT_EYE?:    { x: number; y: number };
  RIGHT_EYE?:   { x: number; y: number };
  LEFT_EAR?:    { x: number; y: number };
  RIGHT_EAR?:   { x: number; y: number };
  LEFT_CHEEK?:  { x: number; y: number };
  RIGHT_CHEEK?: { x: number; y: number };
  MOUTH_LEFT?:  { x: number; y: number };
  MOUTH_RIGHT?: { x: number; y: number };
  NOSE_BASE?:   { x: number; y: number };
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const STEPS = ['Personal', 'Employment', 'Wage', 'Statutory', 'Face ID'];
const DAYS  = [
  { id: 1, label: 'Mon' }, { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' }, { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' }, { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];
const GENDERS = ['Male', 'Female', 'Other'];
const CATS    = ['Daily Wage', 'Monthly', 'Contract', 'Permanent'];

// ─────────────────────────────────────────────────────────────
// Reusable components
// ─────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput style={s.input} placeholderTextColor="#9CA3AF" {...props} />;
}

function SegmentPicker({ options, value, onChange }: {
  options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={s.segRow}>
      {options.map((o) => (
        <Pressable key={o} style={[s.seg, value === o && s.segActive]} onPress={() => onChange(o)}>
          <Text style={[s.segTxt, value === o && s.segTxtActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Toast({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={s.toast}>
      <Ionicons name="checkmark-circle" size={16} color="#fff" />
      <Text style={s.toastTxt}>{message}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Build descriptor from expo-face-detector result (Mobile Only)
// ─────────────────────────────────────────────────────────────
function buildDescriptorFromFace(face: DetectedFace): number[] {
  const W = face.bounds.size.width  || 1;
  const H = face.bounds.size.height || 1;
  const L = face.bounds.origin.x    || 0;
  const T = face.bounds.origin.y    || 0;

  const norm = (pt?: { x: number; y: number }): [number, number] =>
    pt ? [(pt.x - L) / W, (pt.y - T) / H] : [0, 0];

  return [
    ...norm(face.LEFT_EYE),    ...norm(face.RIGHT_EYE),
    ...norm(face.NOSE_BASE),   ...norm(face.MOUTH_LEFT),
    ...norm(face.MOUTH_RIGHT), ...norm(face.LEFT_EAR),
    ...norm(face.RIGHT_EAR),   ...norm(face.LEFT_CHEEK),
    ...norm(face.RIGHT_CHEEK),
    face.leftEyeOpenProbability  ?? 0,
    face.rightEyeOpenProbability ?? 0,
    face.smilingProbability      ?? 0,
    (face.yawAngle  ?? 0) / 180,
    (face.rollAngle ?? 0) / 180,
  ];
}

// ─────────────────────────────────────────────────────────────
// Web Human Instance (Lazy Load)
// ─────────────────────────────────────────────────────────────
let webHumanInstance: any = null;
const getWebHuman = async () => {
  if (webHumanInstance) return webHumanInstance;
  const { default: Human } = await import('@vladmandic/human');
  webHumanInstance = new Human({
    modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models/',
    face: { enabled: true, detector: { rotation: false }, mesh: { enabled: true }, iris: { enabled: true }, description: { enabled: true }, emotion: { enabled: false } },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }
  });
  await webHumanInstance.load();
  await webHumanInstance.warmup();
  return webHumanInstance;
};

// ─────────────────────────────────────────────────────────────
// Face Enrollment Modal
// ─────────────────────────────────────────────────────────────
function FaceEnrollModal({
  visible, onClose, onEnrolled,
}: {
  visible: boolean;
  onClose: () => void;
  onEnrolled: (descriptor: FaceDescriptorPayload, photoUri: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef    = useRef<CameraView>(null);
  const capturingRef = useRef(false);
  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const [faceDetected, setFaceDetected] = useState(false);
  const [isCapturing, setIsCapturing]   = useState(false);
  const [statusMsg, setStatusMsg]       = useState('Position your face in the oval');

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const startTick = useCallback(() => {
    stopTick();
    
    if (Platform.OS === 'web') {
      setFaceDetected(true);
      setStatusMsg('Web Mode: Position face & tap Capture');
      return;
    }

    tickRef.current = setInterval(async () => {
      if (capturingRef.current || !cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.2, base64: false, skipProcessing: true,
        });
        if (!photo?.uri) return;

        const result = await FaceDetector.detectFacesAsync(photo.uri, {
          mode: FaceDetector.FaceDetectorMode.fast,
          detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
          runClassifications: FaceDetector.FaceDetectorClassifications.none,
        });

        const found = result.faces.length > 0;
        setFaceDetected(found);
        setStatusMsg(found ? 'Face detected — tap Capture' : 'Position your face in the oval');
      } catch { /* frame skip */ }
    }, 900);
  }, [stopTick]);

  useEffect(() => {
    if (visible && permission?.granted) {
      const t = setTimeout(() => startTick(), 700); 
      return () => { clearTimeout(t); stopTick(); };
    }
    return () => stopTick();
  }, [visible, permission?.granted, startTick, stopTick]);

  useEffect(() => {
    if (visible) {
      setFaceDetected(Platform.OS === 'web');
      setIsCapturing(false);
      capturingRef.current = false;
      setStatusMsg(Platform.OS === 'web' ? 'Web Mode: Position face & tap Capture' : 'Position your face in the oval');
    }
  }, [visible]);

  const handleCapture = async () => {
    if (capturingRef.current || !cameraRef.current) return;
    capturingRef.current = true;
    setIsCapturing(true);
    stopTick();
    setStatusMsg('Processing...');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92, base64: false, skipProcessing: false,
      });
      if (!photo?.uri) throw new Error('Camera returned no photo URI');

      // ====== WEB MODE: Use @vladmandic/human for proper 1024 embeddings ======
      if (Platform.OS === 'web') {
        try {
          const human = await getWebHuman();
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = photo.uri;
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
          
          const result = await human.detect(img);
          if (!result?.face?.length) {
            Alert.alert(
              'No Face Detected',
              'Ensure your face is fully visible and well-lit, then try again.',
              [{ text: 'Retry', onPress: () => {
                capturingRef.current = false;
                setIsCapturing(false);
                setFaceDetected(Platform.OS === 'web');
                setStatusMsg('Web Mode: Position face & tap Capture');
                startTick();
              }}]
            );
            return;
          }

          // CHANGED: Explicitly cast and map the array so TypeScript knows it is an array of numbers
          const embedding: number[] = Array.from(result.face[0].embedding as number[]).map(Number);
          
          onEnrolled({ landmarks: embedding, capturedAt: new Date().toISOString() }, photo.uri);
          onClose();
        } catch (e: any) {
          console.error('Web Human Detect Error:', e);
          Alert.alert('Capture Error', 'Could not process face. Please try again.');
          capturingRef.current = false;
          setIsCapturing(false);
          setStatusMsg('Web Mode: Position face & tap Capture');
          startTick();
        }
        return;
      }

      // ====== NATIVE MODE: Use ML Kit ======
      const result = await FaceDetector.detectFacesAsync(photo.uri, {
        mode: FaceDetector.FaceDetectorMode.accurate,
        detectLandmarks: FaceDetector.FaceDetectorLandmarks.all,
        runClassifications: FaceDetector.FaceDetectorClassifications.all,
      });

      if (!result.faces.length) {
        Alert.alert(
          'No Face Detected',
          'Ensure your face is fully visible and well-lit, then try again.',
          [{ text: 'Retry', onPress: () => {
            capturingRef.current = false;
            setIsCapturing(false);
            setFaceDetected(false);
            setStatusMsg('Position your face in the oval');
            startTick();
          }}],
        );
        return;
      }

      const descriptor = buildDescriptorFromFace(result.faces[0] as unknown as DetectedFace);
      onEnrolled({ landmarks: descriptor, capturedAt: new Date().toISOString() }, photo.uri);
      onClose();
    } catch (e: any) {
      console.error('Enrollment capture error:', e);
      Alert.alert('Capture Error', e?.message ?? 'Could not capture. Please try again.');
      capturingRef.current = false;
      setIsCapturing(false);
      setStatusMsg(Platform.OS === 'web' ? 'Web Mode: Position face & tap Capture' : 'Position your face in the oval');
      startTick();
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.enrollRoot}>
        {permission?.granted && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="front"
          />
        )}
        <View style={s.enrollOverlay}>
          <View style={s.enrollHeader}>
            <Pressable onPress={onClose} style={s.enrollCloseBtn}>
              <Ionicons name="close" size={22} color="#374151" />
            </Pressable>
            <Text style={s.enrollTitle}>Enroll Face</Text>
            <View style={{ width: 36 }} />
          </View>
          {!permission?.granted ? (
            <View style={s.enrollCenter}>
              <Ionicons name="camera-outline" size={48} color="#9CA3AF" />
              <Text style={s.enrollSubtitle}>Camera permission required</Text>
              <Pressable style={s.enrollGrantBtn} onPress={requestPermission}>
                <Text style={s.enrollGrantBtnTxt}>Grant Permission</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={s.enrollOvalWrap} pointerEvents="none">
                <View style={[
                  s.enrollOval,
                  { borderColor: faceDetected ? '#22C55E' : 'rgba(255,255,255,0.6)' },
                ]} />
              </View>
              <View style={s.enrollStatusWrap}>
                <View style={[
                  s.enrollStatusPill,
                  { backgroundColor: faceDetected ? 'rgba(21,128,61,0.85)' : 'rgba(0,0,0,0.55)' },
                ]}>
                  <Ionicons
                    name={faceDetected ? 'checkmark-circle' : 'scan-outline'}
                    size={14} color="#fff"
                  />
                  <Text style={s.enrollStatusTxt}>{statusMsg}</Text>
                </View>
              </View>
              <View style={s.enrollFooter}>
                <Pressable
                  style={[s.captureBtn, isCapturing && s.captureBtnLoading]}
                  onPress={handleCapture}
                  disabled={isCapturing}
                >
                  {isCapturing
                    ? <ActivityIndicator size="small" color="#fff" />
                    : (
                      <>
                        <Ionicons name="camera" size={22} color="#fff" />
                        <Text style={s.captureBtnTxt}>Capture Face</Text>
                      </>
                    )
                  }
                </Pressable>
                <Text style={s.enrollHint}>
                  {faceDetected
                    ? 'Face in frame — tap to capture'
                    : 'Centre your face in the oval, then tap Capture'}
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Add/Edit Worker Screen
// ─────────────────────────────────────────────────────────────
export default function AddWorkerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ workerId?: string }>();
  const { profile, limits } = useAuth();
  const isEditing = !!params.workerId;

  const [settings, setSettings]               = useState<OrgSettings | null>(null);
  const [availableShifts, setAvailableShifts] = useState<ShiftConfig[]>([]);
  const [availBranches, setAvailBranches]     = useState<Branch[]>([]);
  const [availDepts, setAvailDepts]           = useState<string[]>([]);
  const [step, setStep]                       = useState(0);
  const [saving, setSaving]                   = useState(false);

  const [enrollModalVisible, setEnrollModalVisible] = useState(false);
  const [faceDescriptor, setFaceDescriptor]         = useState<FaceDescriptorPayload | null>(null);
  const [faceCapturedUri, setFaceCapturedUri]       = useState<string | null>(null);
  const [faceUploading, setFaceUploading]           = useState(false);
  const [facePhotoUrl, setFacePhotoUrl]             = useState<string | null>(null);
  const [toast, setToast]                           = useState(false);
  const [isLeaveOverride, setIsLeaveOverride]       = useState(false);

  const [form, setForm] = useState<Partial<Worker>>({
    name: '', phone: '', aadhar: '', dob: '',
    gender: '' as any, category: 'Daily Wage',
    department: '', designation: '',
    joinedDate: new Date().toISOString().split('T')[0],
    shiftId: 'default', branchId: 'default',
    weeklyOffOverride: undefined, leaveBalances: undefined,
    wageConfig: {
      type: 'DAILY', amount: 0, overtimeEligible: false,
      allowances: { travel: 0, food: 0, nightShift: 0 },
      monthlyBreakdown: { basic: 0, hra: 0, others: 0 },
    },
    uan: '', esicIp: '', pan: '', fatherName: '',
    dateOfBirth: '', dateOfJoining: '', dateOfExit: '',
    status: 'ACTIVE',
  });

  useEffect(() => {
    if (!profile?.tenantId) return;
    dbService.getOrgSettings(profile.tenantId).then((settings) => {
      setSettings(settings);
      setAvailableShifts(settings.shifts ?? []);
      const branches = settings.branches?.length ? settings.branches : [{ id: 'default', name: 'Main Branch' }];
      const depts    = settings.departments?.length ? settings.departments : ['Production','Packaging','Maintenance','Loading','Quality'];
      setAvailBranches(branches);
      setAvailDepts(depts);
      if (!isEditing) {
        setForm((f) => ({ ...f, shiftId: settings.shifts?.[0]?.id ?? 'default', branchId: branches[0].id, department: depts[0] }));
      }
    });
  }, [profile?.tenantId, isEditing]);

  useEffect(() => {
    if (!isEditing || !params.workerId || !profile?.tenantId) return;
    dbService.getWorkers(profile.tenantId).then((workers) => {
      const w = workers.find((x) => x.id === params.workerId);
      if (!w) return;
      setForm(w);
      if ((w as any).faceDescriptor?.landmarks?.length) {
        setFaceDescriptor((w as any).faceDescriptor);
        setFacePhotoUrl(w.photoUrl ?? null);
      }
      if (w.leaveBalances) setIsLeaveOverride(true);
    });
  }, [isEditing, params.workerId, profile?.tenantId]);

  const update      = (patch: Partial<Worker>) => setForm((f) => ({ ...f, ...patch }));
  const updateWage  = (patch: any) => setForm((f) => ({ ...f, wageConfig: { ...f.wageConfig!, ...patch } }));
  const updateAllowance = (patch: any) =>
    setForm((f) => ({ ...f, wageConfig: { ...f.wageConfig!, allowances: { ...f.wageConfig!.allowances, ...patch } } }));
  const updateMonthly = (field: 'basic' | 'hra' | 'others', val: string) => {
    const n = parseFloat(val) || 0;
    setForm((f) => {
      const mb = { ...(f.wageConfig?.monthlyBreakdown ?? { basic: 0, hra: 0, others: 0 }), [field]: n };
      return { ...f, wageConfig: { ...f.wageConfig!, monthlyBreakdown: mb, amount: mb.basic + mb.hra + mb.others } };
    });
  };

  const showToast = () => { setToast(true); setTimeout(() => setToast(false), 3000); };

  const handleFaceEnrolled = useCallback(async (descriptor: FaceDescriptorPayload, photoUri: string) => {
    setFaceDescriptor(descriptor);
    setFaceCapturedUri(photoUri);
    if (!profile?.tenantId) return;
    setFaceUploading(true);
    try {
      const workerId = isEditing && params.workerId ? params.workerId : `temp_${Date.now()}`;
      const path     = `workers/${profile.tenantId}/${workerId}/face.jpg`;
      const response = await fetch(photoUri);
      const blob     = await response.blob();
      
      const sRef     = storageRef(storage, path);
      
      await uploadBytes(sRef, blob, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(sRef);
      setFacePhotoUrl(url);
      showToast();
    } catch (e) {
      console.error('Face upload error:', e);
    } finally {
      setFaceUploading(false);
    }
  }, [profile?.tenantId, isEditing, params.workerId]);

  const validate = (): boolean => {
    if (step === 0) {
      if (!form.name?.trim())                                   { Alert.alert('Required', 'Full Name is required.');     return false; }
      if (!form.phone?.trim() || !/^\d{10}$/.test(form.phone)) { Alert.alert('Required', 'Phone must be 10 digits.');   return false; }
      if (!form.gender)                                         { Alert.alert('Required', 'Please select Gender.');      return false; }
      if (!form.dob)                                            { Alert.alert('Required', 'Date of Birth is required.'); return false; }
    }
    if (step === 1 && !form.designation?.trim()) { Alert.alert('Required', 'Designation is required.'); return false; }
    if (step === 2 && (!form.wageConfig?.amount || form.wageConfig.amount <= 0))
      { Alert.alert('Required', 'Wage Amount must be greater than 0.'); return false; }
    return true;
  };

  const handleSave = async () => {
    if (!profile?.tenantId) return;
    setSaving(true);
    try {
      let finalPhotoUrl   = facePhotoUrl ?? form.photoUrl ?? null;
      let finalDescriptor = faceDescriptor ?? (form as any).faceDescriptor ?? null;

      if (faceCapturedUri && !facePhotoUrl) {
        try {
          const workerId = isEditing && params.workerId ? params.workerId : `temp_${Date.now()}`;
          const path     = `workers/${profile.tenantId}/${workerId}/face.jpg`;
          const response = await fetch(faceCapturedUri);
          const blob     = await response.blob();
          const sRef     = storageRef(storage, path);
          
          await uploadBytes(sRef, blob, { contentType: 'image/jpeg' });
          finalPhotoUrl  = await getDownloadURL(sRef);
        } catch { /* best effort */ }
      }

      const workerData: any = {
        ...form,
        tenantId: profile.tenantId,
        photoUrl: finalPhotoUrl,
        faceDescriptor: finalDescriptor,
        status: 'ACTIVE',
      };
      if (!isLeaveOverride) delete workerData.leaveBalances;

      Object.keys(workerData).forEach(key => {
        if (workerData[key] === undefined) {
          delete workerData[key];
        }
      });
      if (workerData.wageConfig) {
        Object.keys(workerData.wageConfig).forEach(key => {
          if (workerData.wageConfig[key] === undefined) {
            delete workerData.wageConfig[key];
          }
        });
      }
      
      if (isEditing && params.workerId) {
        await dbService.updateWorker(params.workerId, workerData);
      } else {
        await dbService.addWorker(workerData);
        await dbService.addNotification({
          tenantId: profile.tenantId,
          title: 'New Worker Registered',
          message: `${form.name} was successfully added to the system.`,
          type: 'INFO', createdAt: new Date().toISOString(), read: false,
        });
      }
      router.back();
    } catch (e: any) {
      console.error("Save Error:", e);
      Alert.alert('Save Failed', e.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isFaceEnrolled = !!(faceDescriptor || (form as any).faceDescriptor);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => (step > 0 ? setStep((v) => v - 1) : router.back())} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#374151" />
        </Pressable>
        <Text style={s.headerTitle}>{isEditing ? 'Edit Worker' : 'New Registration'}</Text>
        <View style={s.stepBadge}><Text style={s.stepBadgeTxt}>Step {step + 1}/{STEPS.length}</Text></View>
      </View>

      {/* Step bar */}
      <View style={s.stepBar}>
        {STEPS.map((label, i) => (
          <View key={label} style={s.stepItem}>
            <View style={[s.stepDot, i < step && s.stepDotDone, i === step && s.stepDotActive]}>
              {i < step
                ? <Ionicons name="checkmark" size={12} color="#fff" />
                : <Text style={[s.stepDotTxt, i === step && { color: '#fff' }]}>{i + 1}</Text>
              }
            </View>
            <Text style={[s.stepLabel, i === step && { color: '#4F46E5' }]}>{label}</Text>
          </View>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

        {/* STEP 0 */}
        {step === 0 && (
          <View style={s.stepContent}>
            <Text style={s.sectionTitle}>Personal Information</Text>
            <Field label="Full Name *"><Input value={form.name} onChangeText={(v) => update({ name: v })} placeholder="e.g. Ramesh Kumar" /></Field>
            <Field label="Mobile Number *"><Input value={form.phone} onChangeText={(v) => update({ phone: v.replace(/\D/g, '') })} placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} /></Field>
            <Field label="Gender *"><SegmentPicker options={GENDERS} value={form.gender ?? ''} onChange={(v) => update({ gender: v as any })} /></Field>
            <Field label="Date of Birth *"><Input value={form.dob} onChangeText={(v) => update({ dob: v })} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" /></Field>
            <Field label="Aadhar Number (Optional)"><Input value={form.aadhar} onChangeText={(v) => update({ aadhar: v.replace(/\D/g, '') })} placeholder="12-digit UID" keyboardType="numeric" maxLength={12} /></Field>
          </View>
        )}

        {/* STEP 1 */}
        {step === 1 && (
          <View style={s.stepContent}>
            <Text style={s.sectionTitle}>Employment Details</Text>
            <Field label="Category"><SegmentPicker options={CATS} value={form.category ?? 'Daily Wage'} onChange={(v) => update({ category: v as any })} /></Field>
            <Field label="Branch">
              <View style={s.pickerWrap}>
                {availBranches.map((b) => (
                  <Pressable key={b.id} style={[s.seg, form.branchId === b.id && s.segActive]} onPress={() => update({ branchId: b.id })}>
                    <Text style={[s.segTxt, form.branchId === b.id && s.segTxtActive]}>{b.name}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            <Field label="Department">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.segRow}>
                  {availDepts.map((d) => (
                    <Pressable key={d} style={[s.seg, form.department === d && s.segActive]} onPress={() => update({ department: d })}>
                      <Text style={[s.segTxt, form.department === d && s.segTxtActive]}>{d}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </Field>
            <Field label="Designation *"><Input value={form.designation} onChangeText={(v) => update({ designation: v })} placeholder="e.g. Helper, Operator" /></Field>
            <Field label="Shift">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.segRow}>
                  {availableShifts.map((sh) => (
                    <Pressable key={sh.id} style={[s.seg, form.shiftId === sh.id && s.segActive]} onPress={() => update({ shiftId: sh.id })}>
                      <Text style={[s.segTxt, form.shiftId === sh.id && s.segTxtActive]}>{sh.name} ({sh.startTime}–{sh.endTime})</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </Field>
            <Field label="Weekly Off Override">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.segRow}>
                  <Pressable style={[s.seg, !form.weeklyOffOverride && s.segActive]} onPress={() => update({ weeklyOffOverride: undefined })}>
                    <Text style={[s.segTxt, !form.weeklyOffOverride && s.segTxtActive]}>Factory Default</Text>
                  </Pressable>
                  {DAYS.map((d) => (
                    <Pressable key={d.id} style={[s.seg, form.weeklyOffOverride?.[0] === d.id && s.segActive]} onPress={() => update({ weeklyOffOverride: [d.id] })}>
                      <Text style={[s.segTxt, form.weeklyOffOverride?.[0] === d.id && s.segTxtActive]}>{d.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </Field>
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleLabel}>Leave Policy Override</Text>
                <Text style={s.toggleSub}>Assign custom leave quota for this worker</Text>
              </View>
              <Switch
                value={isLeaveOverride}
                onValueChange={(v) => {
                  setIsLeaveOverride(v);
                  if (v) update({ leaveBalances: { cl: settings?.leavePolicy?.cl ?? 0, sl: settings?.leavePolicy?.sl ?? 0, pl: settings?.leavePolicy?.pl ?? 0 } });
                  else update({ leaveBalances: undefined });
                }}
                trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
                thumbColor={isLeaveOverride ? '#4F46E5' : '#F3F4F6'}
              />
            </View>
            {isLeaveOverride && (
              <View style={s.leavesRow}>
                {(['cl', 'sl', 'pl'] as const).map((key) => (
                  <View key={key} style={s.leaveField}>
                    <Text style={s.fieldLabel}>{key.toUpperCase()}</Text>
                    <Input
                      value={String(form.leaveBalances?.[key] ?? 0)}
                      onChangeText={(v) => update({ leaveBalances: { ...(form.leaveBalances ?? { cl: 0, sl: 0, pl: 0 }), [key]: parseInt(v) || 0 } })}
                      keyboardType="numeric"
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <View style={s.stepContent}>
            <Text style={s.sectionTitle}>Wage Configuration</Text>
            <Field label="Wage Type">
              <SegmentPicker options={['DAILY', 'MONTHLY']} value={form.wageConfig?.type ?? 'DAILY'} onChange={(v) => updateWage({ type: v })} />
            </Field>
            {form.wageConfig?.type === 'DAILY' ? (
              <Field label="Daily Rate (₹) *">
                <Input value={String(form.wageConfig.amount || '')} onChangeText={(v) => updateWage({ amount: parseFloat(v) || 0 })} keyboardType="numeric" placeholder="e.g. 500" />
              </Field>
            ) : (
              <View style={s.monthlyCard}>
                <Text style={s.monthlyCardTitle}>Monthly Salary Structure</Text>
                {[{ key: 'basic', label: 'Basic + DA *' }, { key: 'hra', label: 'HRA' }, { key: 'others', label: 'Other Allowances' }].map(({ key, label }) => (
                  <Field key={key} label={label}>
                    <Input value={String((form.wageConfig?.monthlyBreakdown as any)?.[key] || '')} onChangeText={(v) => updateMonthly(key as any, v)} keyboardType="numeric" placeholder="₹ 0" />
                  </Field>
                ))}
                <View style={s.grossRow}>
                  <Text style={s.grossLabel}>Total Gross</Text>
                  <Text style={s.grossVal}>₹{(form.wageConfig?.amount ?? 0).toLocaleString('en-IN')}</Text>
                </View>
              </View>
            )}
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleLabel}>Overtime Eligible</Text>
                <Text style={s.toggleSub}>Is this worker eligible for OT pay?</Text>
              </View>
              <Switch value={form.wageConfig?.overtimeEligible ?? false} onValueChange={(v) => updateWage({ overtimeEligible: v })} trackColor={{ false: '#D1D5DB', true: '#818CF8' }} thumbColor={form.wageConfig?.overtimeEligible ? '#4F46E5' : '#F3F4F6'} />
            </View>
            {form.wageConfig?.overtimeEligible && (
              <Field label="OT Rate Per Hour (₹) *">
                <Input value={String(form.wageConfig.overtimeRatePerHour || '')} onChangeText={(v) => updateWage({ overtimeRatePerHour: parseFloat(v) || 0 })} keyboardType="numeric" placeholder="e.g. 100" />
              </Field>
            )}
            {(limits as any)?.allowancesAndDeductionsEnabled && (
              <View style={s.monthlyCard}>
                <Text style={s.monthlyCardTitle}>Daily Allowances (Optional)</Text>
                {[{ key: 'travel', label: 'Travel (₹/day)' }, { key: 'food', label: 'Food (₹/day)' }].map(({ key, label }) => (
                  <Field key={key} label={label}>
                    <Input value={String((form.wageConfig?.allowances as any)?.[key] || '')} onChangeText={(v) => updateAllowance({ [key]: parseFloat(v) || 0 })} keyboardType="numeric" placeholder="₹ 0" />
                  </Field>
                ))}
              </View>
            )}
          </View>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <View style={s.stepContent}>
            <Text style={s.sectionTitle}>Statutory Compliance</Text>
            {(limits as any)?.statutoryComplianceEnabled ? (
              <>
                <Text style={s.sectionSub}>Required for EPFO ECR & ESIC Return generation</Text>
                <View style={s.statRow}>
                  <View style={{ flex: 1 }}><Field label="UAN (PF Number)"><Input value={form.uan ?? ''} onChangeText={(v) => update({ uan: v.replace(/\D/g, '') })} placeholder="12-digit UAN" keyboardType="numeric" maxLength={12} /></Field></View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}><Field label="ESIC IP Number"><Input value={form.esicIp ?? ''} onChangeText={(v) => update({ esicIp: v.replace(/\D/g, '') })} placeholder="10–17 digits" keyboardType="numeric" maxLength={17} /></Field></View>
                </View>
                <Field label="PAN Number"><Input value={form.pan ?? ''} onChangeText={(v) => update({ pan: v.toUpperCase() })} placeholder="e.g. ABCDE1234F" autoCapitalize="characters" maxLength={10} /></Field>
                <Field label="Father's / Husband's Name"><Input value={form.fatherName ?? ''} onChangeText={(v) => update({ fatherName: v })} placeholder="For EPFO records" /></Field>
                <View style={s.statRow}>
                  <View style={{ flex: 1 }}><Field label="DOB (DD/MM/YYYY)"><Input value={form.dateOfBirth ?? ''} onChangeText={(v) => update({ dateOfBirth: v })} placeholder="15/08/1990" keyboardType="numbers-and-punctuation" maxLength={10} /></Field></View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}><Field label="DOJ (DD/MM/YYYY)"><Input value={form.dateOfJoining ?? ''} onChangeText={(v) => update({ dateOfJoining: v })} placeholder="01/01/2024" keyboardType="numbers-and-punctuation" maxLength={10} /></Field></View>
                </View>
                <Field label="Date of Exit (optional)"><Input value={form.dateOfExit ?? ''} onChangeText={(v) => update({ dateOfExit: v })} placeholder="31/12/2024" keyboardType="numbers-and-punctuation" maxLength={10} /></Field>
                <View style={s.infoCard}>
                  <Ionicons name="information-circle-outline" size={14} color="#1D4ED8" />
                  <View style={{ flex: 1, marginLeft: 8 }}><Text style={s.infoTxt}>UAN required for EPFO ECR. ESIC IP required if gross ≤ ₹21,000. Dates must be DD/MM/YYYY for exports.</Text></View>
                </View>
              </>
            ) : (
              <View style={s.lockedCard}>
                <Ionicons name="lock-closed" size={32} color="#9CA3AF" />
                <Text style={s.lockedTitle}>Enterprise Feature</Text>
                <Text style={s.lockedSub}>Statutory compliance requires the Enterprise plan.</Text>
                <Pressable style={s.skipBtn} onPress={() => setStep(4)}><Text style={s.skipBtnTxt}>Skip to Face Enrollment</Text></Pressable>
              </View>
            )}
          </View>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <View style={s.stepContent}>
            <Text style={s.sectionTitle}>Face Enrollment</Text>
            <Text style={s.sectionSub}>Enroll the worker's face for kiosk attendance recognition.</Text>
            <View style={[s.faceCard, isFaceEnrolled && s.faceCardEnrolled]}>
              <View style={[s.faceAvatar, isFaceEnrolled ? s.faceAvatarEnrolled : s.faceAvatarEmpty]}>
                <Ionicons name={isFaceEnrolled ? 'person' : 'scan-outline'} size={32} color={isFaceEnrolled ? '#16A34A' : '#9CA3AF'} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={s.faceStatusRow}>
                  <Text style={s.faceStatusLabel}>Face ID</Text>
                  <View style={[s.faceStatusBadge, isFaceEnrolled ? s.faceStatusBadgeOk : s.faceStatusBadgeNo]}>
                    <Ionicons name={isFaceEnrolled ? 'checkmark-circle' : 'close-circle-outline'} size={11} color={isFaceEnrolled ? '#16A34A' : '#DC2626'} />
                    <Text style={[s.faceStatusBadgeTxt, { color: isFaceEnrolled ? '#16A34A' : '#DC2626' }]}>{isFaceEnrolled ? 'Enrolled' : 'Not enrolled'}</Text>
                  </View>
                </View>
                {faceDescriptor?.capturedAt && <Text style={s.faceCapturedAt}>Enrolled {new Date(faceDescriptor.capturedAt).toLocaleDateString('en-IN')}</Text>}
                {faceUploading && <View style={s.faceUploadRow}><ActivityIndicator size="small" color="#4F46E5" /><Text style={s.faceUploadTxt}>Uploading photo...</Text></View>}
              </View>
            </View>
            <Pressable style={[s.enrollBtn, isFaceEnrolled && s.enrollBtnReenroll]} onPress={() => setEnrollModalVisible(true)}>
              <Ionicons name={isFaceEnrolled ? 'refresh-circle-outline' : 'camera-outline'} size={18} color={isFaceEnrolled ? '#4F46E5' : '#fff'} />
              <Text style={[s.enrollBtnTxt, isFaceEnrolled && s.enrollBtnTxtReenroll]}>{isFaceEnrolled ? 'Re-enroll Face' : 'Enroll Face'}</Text>
            </Pressable>
            {!isFaceEnrolled && <Text style={s.enrollSkipNote}>You can skip for now and enroll later from the worker profile.</Text>}
            <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-done-outline" size={18} color="#fff" />}
              <Text style={s.saveBtnTxt}>{saving ? 'Saving...' : isEditing ? 'Update Worker' : 'Complete Registration'}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Footer nav */}
      {step < 4 && (
        <View style={s.footer}>
          <Pressable style={s.footerBack} onPress={() => (step > 0 ? setStep((v) => v - 1) : router.back())}>
            <Text style={s.footerBackTxt}>{step === 0 ? 'Cancel' : 'Back'}</Text>
          </Pressable>
          <Pressable style={s.footerNext} onPress={() => { if (validate()) setStep((v) => v + 1); }}>
            <Text style={s.footerNextTxt}>Next</Text>
            <Ionicons name="chevron-forward" size={16} color="#fff" />
          </Pressable>
        </View>
      )}

      <FaceEnrollModal visible={enrollModalVisible} onClose={() => setEnrollModalVisible(false)} onEnrolled={handleFaceEnrolled} />
      <Toast message="Face enrolled successfully ✓" visible={toast} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const OVAL_W = 240;
const OVAL_H = OVAL_W * 1.3;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  stepBadge: { backgroundColor: '#EEF2FF', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  stepBadgeTxt: { color: '#4F46E5', fontSize: 11, fontWeight: '800' },
  stepBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#E5E7EB' },
  stepDotActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  stepDotDone: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  stepDotTxt: { fontSize: 10, fontWeight: '700', color: '#6B7280' },
  stepLabel: { fontSize: 9, fontWeight: '700', color: '#9CA3AF' },
  stepContent: { gap: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: '#111827', marginBottom: 4 },
  sectionSub: { fontSize: 12, color: '#6B7280', marginTop: -8, marginBottom: 4 },
  field: { gap: 5 },
  fieldLabel: { fontSize: 10, fontWeight: '800', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#111827', backgroundColor: '#fff' },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  seg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', borderWidth: 1.5, borderColor: '#E5E7EB' },
  segActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  segTxt: { fontSize: 12, fontWeight: '700', color: '#374151' },
  segTxtActive: { color: '#fff' },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  monthlyCard: { backgroundColor: '#EEF2FF', borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: '#C7D2FE' },
  monthlyCardTitle: { fontSize: 13, fontWeight: '800', color: '#3730A3' },
  grossRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#C7D2FE' },
  grossLabel: { fontSize: 12, fontWeight: '800', color: '#3730A3' },
  grossVal: { fontSize: 20, fontWeight: '900', color: '#4F46E5' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E5E7EB', gap: 10 },
  toggleLabel: { fontSize: 13, fontWeight: '800', color: '#111827' },
  toggleSub: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  leavesRow: { flexDirection: 'row', gap: 10 },
  leaveField: { flex: 1 },
  statRow: { flexDirection: 'row' },
  infoCard: { flexDirection: 'row', backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#BFDBFE', alignItems: 'flex-start' },
  infoTxt: { fontSize: 11, color: '#1D4ED8', lineHeight: 16 },
  lockedCard: { alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 16, padding: 32, borderWidth: 1, borderColor: '#E5E7EB', gap: 10 },
  lockedTitle: { fontSize: 16, fontWeight: '800', color: '#374151' },
  lockedSub: { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },
  skipBtn: { backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  skipBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  faceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: '#E5E7EB' },
  faceCardEnrolled: { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' },
  faceAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  faceAvatarEnrolled: { backgroundColor: '#DCFCE7' },
  faceAvatarEmpty: { backgroundColor: '#F3F4F6' },
  faceStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  faceStatusLabel: { fontSize: 14, fontWeight: '800', color: '#111827' },
  faceStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  faceStatusBadgeOk: { backgroundColor: '#DCFCE7' },
  faceStatusBadgeNo: { backgroundColor: '#FEE2E2' },
  faceStatusBadgeTxt: { fontSize: 10, fontWeight: '800' },
  faceCapturedAt: { fontSize: 11, color: '#6B7280' },
  faceUploadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  faceUploadTxt: { fontSize: 11, color: '#4F46E5' },
  enrollBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4F46E5', borderRadius: 14, paddingVertical: 14 },
  enrollBtnReenroll: { backgroundColor: '#EEF2FF', borderWidth: 1.5, borderColor: '#C7D2FE' },
  enrollBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  enrollBtnTxtReenroll: { color: '#4F46E5' },
  enrollSkipNote: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: -6 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 14, paddingVertical: 16, marginTop: 8 },
  saveBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  footerBack: { paddingHorizontal: 20, paddingVertical: 12 },
  footerBackTxt: { color: '#6B7280', fontSize: 14, fontWeight: '700' },
  footerNext: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  footerNextTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  toast: { position: 'absolute', bottom: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#16A34A', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
  toastTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  enrollRoot: { flex: 1, backgroundColor: '#000' },
  enrollOverlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'column', justifyContent: 'space-between' },
  enrollHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12 },
  enrollCloseBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  enrollTitle: { color: '#fff', fontSize: 16, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  enrollCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#111827' },
  enrollSubtitle: { color: '#9CA3AF', fontSize: 14 },
  enrollGrantBtn: { backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  enrollGrantBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  enrollOvalWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  enrollOval: { width: OVAL_W, height: OVAL_H, borderRadius: OVAL_W / 2, borderWidth: 3, marginTop: -60 },
  enrollStatusWrap: { alignItems: 'center', paddingBottom: 16 },
  enrollStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8 },
  enrollStatusTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },
  enrollFooter: { alignItems: 'center', gap: 10, paddingBottom: 48, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  captureBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#4F46E5', borderRadius: 50, paddingHorizontal: 36, paddingVertical: 18 },
  captureBtnLoading: { backgroundColor: '#6B7280' },
  captureBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  enrollHint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center', paddingHorizontal: 32 },
});
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
  ActivityIndicator,
} from 'react-native';
import MapView, {
  Marker,
  Heatmap,
  PROVIDER_GOOGLE,
  type Region,
} from 'react-native-maps';
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { measure } from '../../lib/perf';
import { Avatar } from '../../components/Avatar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MapMode = 'friends' | 'all';

interface EateryPin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  photos: string[];
  city: string;
  location_text: string;
}

interface ClusteredPin extends EateryPin {
  clusterCount: number;
}

interface FriendReviewEntry {
  eatery_id: string;
  favourite_dish: string | null;
  users: { id: string; name: string; photo_url: string | null };
  eateries: { latitude: number; longitude: number };
}

interface FriendMapData {
  // eateryId → count of friend reviews
  countMap: Record<string, number>;
  // eateryId → top (most-recent) favourite dish
  topDishMap: Record<string, string | null>;
  // eateryId → up to 3 friend user objects
  avatarMap: Record<string, { id: string; name: string; photo_url: string | null }[]>;
  // heatmap points
  heatPoints: { latitude: number; longitude: number; weight: number }[];
}

interface SheetDetail {
  friendCount: number;
  topDish: string | null;
  friendAvatars: { id: string; name: string; photo_url: string | null }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REGION_RIYADH: Region = {
  latitude: 24.7136,
  longitude: 46.6753,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

const REGION_DUBAI: Region = {
  latitude: 25.2048,
  longitude: 55.2708,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

const SHEET_SNAP_POINTS = ['30%', '55%'];
const CLUSTER_THRESHOLD = 8;
const CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function regionToRadiusMeters(region: Region): number {
  const latDist = region.latitudeDelta * 111_000;
  const lngDist =
    region.longitudeDelta * 111_000 * Math.cos((region.latitude * Math.PI) / 180);
  const diagonal = Math.sqrt(latDist ** 2 + lngDist ** 2);
  return diagonal * 0.72; // 0.6 × 1.2 buffer
}

function cacheKey(region: Region): string {
  return `${region.latitude.toFixed(2)},${region.longitude.toFixed(2)},${region.latitudeDelta.toFixed(2)}`;
}

function clusterPins(pins: EateryPin[], latDelta: number): ClusteredPin[] {
  if (latDelta < 0.04 || pins.length <= CLUSTER_THRESHOLD) {
    return pins.map((p) => ({ ...p, clusterCount: 1 }));
  }
  const cellSize = latDelta * 0.14;
  const grid = new Map<string, EateryPin[]>();
  for (const pin of pins) {
    const key = `${Math.round(pin.latitude / cellSize)},${Math.round(pin.longitude / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(pin);
  }
  return Array.from(grid.values()).map((group) => {
    const lat = group.reduce((s, p) => s + p.latitude, 0) / group.length;
    const lng = group.reduce((s, p) => s + p.longitude, 0) / group.length;
    return { ...group[0], latitude: lat, longitude: lng, clusterCount: group.length };
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleBar({ mode, onToggle }: { mode: MapMode; onToggle: (m: MapMode) => void }) {
  return (
    <View style={tb.wrap}>
      {(['friends', 'all'] as MapMode[]).map((m) => (
        <Pressable
          key={m}
          style={[tb.seg, mode === m && tb.segActive]}
          onPress={() => onToggle(m)}
        >
          <Text style={[tb.label, mode === m && tb.labelActive]}>
            {m === 'friends' ? 'Friends' : 'All'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const tb = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 999,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  seg: { paddingHorizontal: 20, paddingVertical: 7, borderRadius: 999 },
  segActive: { backgroundColor: theme.PRIMARY },
  label: { fontSize: 14, fontWeight: '600', color: theme.MUTED },
  labelActive: { color: '#fff' },
});

// --

function PinAvatarStack({
  avatars,
  extra,
}: {
  avatars: { id: string; name: string; photo_url: string | null }[];
  extra: number;
}) {
  return (
    <View style={av.row}>
      {avatars.map((a, i) => (
        <View key={a.id} style={[av.wrap, { marginLeft: i === 0 ? 0 : -6 }]}>
          <Avatar uri={a.photo_url} name={a.name} size={18} />
        </View>
      ))}
      {extra > 0 && (
        <View style={[av.extra, { marginLeft: -6 }]}>
          <Text style={av.extraText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

const av = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  wrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  extra: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.SURFACE,
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  extraText: { fontSize: 8, fontWeight: '700', color: theme.MUTED },
});

// --

function EateryMarkerView({
  pin,
  friendAvatars,
  extraFriends,
  pulse,
  hasPulse,
}: {
  pin: EateryPin;
  friendAvatars: { id: string; name: string; photo_url: string | null }[];
  extraFriends: number;
  pulse: Animated.Value;
  hasPulse: boolean;
}) {
  const scale = hasPulse
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] })
    : 1;

  return (
    <View style={mk.container}>
      {/* Friend avatars above pin */}
      {friendAvatars.length > 0 && (
        <View style={mk.avatarAbove}>
          <PinAvatarStack avatars={friendAvatars} extra={extraFriends} />
        </View>
      )}
      {/* Pin circle */}
      <Animated.View style={[mk.pin, { transform: [{ scale }] }]}>
        {pin.photos?.[0] ? (
          <Image
            source={{ uri: pin.photos[0] }}
            style={mk.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={mk.photoPlaceholder}>
            <Ionicons name="restaurant" size={20} color={theme.PRIMARY} />
          </View>
        )}
      </Animated.View>
      {/* Callout arrow */}
      <View style={mk.arrow} />
    </View>
  );
}

const mk = StyleSheet.create({
  container: { alignItems: 'center' },
  avatarAbove: { marginBottom: 2 },
  pin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    borderColor: '#fff',
    backgroundColor: theme.PRIMARY_LIGHT,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  photo: { width: 44, height: 44 },
  photoPlaceholder: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#fff',
    marginTop: -1,
  },
});

// --

function ClusterMarkerView({ count }: { count: number }) {
  return (
    <View style={cl.circle}>
      <Text style={cl.text}>{count}</Text>
    </View>
  );
}

const cl = StyleSheet.create({
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '800' },
});

// --

function LongPressBar({
  coord,
  onConfirm,
  onDismiss,
}: {
  coord: { latitude: number; longitude: number };
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={lp.bar}>
      <Ionicons name="location-outline" size={18} color={theme.TEXT} />
      <Text style={lp.label}>Add an eatery here?</Text>
      <Pressable style={lp.confirm} onPress={onConfirm}>
        <Text style={lp.confirmText}>Add</Text>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={8}>
        <Ionicons name="close" size={18} color={theme.MUTED} />
      </Pressable>
    </View>
  );
}

const lp = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  label: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.TEXT },
  confirm: {
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  confirmText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function MapScreen() {
  const [mode, setMode] = useState<MapMode>('friends');
  const [initialRegion, setInitialRegion] = useState<Region>(REGION_RIYADH);
  const [pins, setPins] = useState<EateryPin[]>([]);
  const [friendData, setFriendData] = useState<FriendMapData>({
    countMap: {},
    topDishMap: {},
    avatarMap: {},
    heatPoints: [],
  });
  const [selectedPin, setSelectedPin] = useState<EateryPin | null>(null);
  const [sheetDetail, setSheetDetail] = useState<SheetDetail | null>(null);
  const [loadingPins, setLoadingPins] = useState(false);
  const [longPressCoord, setLongPressCoord] = useState<{ latitude: number; longitude: number } | null>(null);

  const mapRef = useRef<MapView>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const regionRef = useRef<Region>(initialRegion);
  const regionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinCacheRef = useRef<Record<string, { data: EateryPin[]; ts: number }>>({});
  const friendIdsRef = useRef<string[]>([]);

  // Pulse animation — shared across all pulsing pins
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    measure('map.load', 'navigation', loadInitial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadInitial() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Set initial region from user city
      const { data: profile } = await supabase
        .from('users')
        .select('city')
        .eq('id', user.id)
        .single();

      const region = profile?.city === 'dubai' ? REGION_DUBAI : REGION_RIYADH;
      setInitialRegion(region);
      regionRef.current = region;

      // Load friend IDs
      const { data: edges } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted');

      const ids = (edges ?? []).map((e) =>
        e.requester_id === user.id ? e.addressee_id : e.requester_id,
      );
      friendIdsRef.current = ids;

      if (ids.length > 0) {
        loadFriendData(ids);
      }

      // Fetch initial pins
      fetchPins(region);
    } catch (e) {
      logger.error('Map initial load failed', e);
    }
  }

  async function loadFriendData(ids: string[]) {
    try {
      const { data } = await supabase
        .from('reviews')
        .select('eatery_id, favourite_dish, created_at, users(id, name, photo_url), eateries(latitude, longitude)')
        .in('user_id', ids)
        .order('created_at', { ascending: false });

      const rows = (data ?? []) as unknown as FriendReviewEntry[];

      const countMap: Record<string, number> = {};
      const topDishMap: Record<string, string | null> = {};
      const avatarMap: Record<string, { id: string; name: string; photo_url: string | null }[]> = {};
      const heatPointMap: Record<string, { latitude: number; longitude: number; weight: number }> = {};

      for (const row of rows) {
        const eid = row.eatery_id;
        countMap[eid] = (countMap[eid] ?? 0) + 1;
        if (!topDishMap[eid]) topDishMap[eid] = row.favourite_dish;
        if (!avatarMap[eid]) avatarMap[eid] = [];
        if (avatarMap[eid].length < 3 && !avatarMap[eid].find((a) => a.id === row.users.id)) {
          avatarMap[eid].push(row.users);
        }
        if (!heatPointMap[eid]) {
          heatPointMap[eid] = {
            latitude: row.eateries.latitude,
            longitude: row.eateries.longitude,
            weight: 0,
          };
        }
        heatPointMap[eid].weight = countMap[eid];
      }

      setFriendData({
        countMap,
        topDishMap,
        avatarMap,
        heatPoints: Object.values(heatPointMap),
      });
    } catch (e) {
      logger.error('Failed to load friend map data', e);
    }
  }

  // ── Pin fetching ──────────────────────────────────────────────────────────

  async function fetchPins(region: Region) {
    const key = cacheKey(region);
    const cached = pinCacheRef.current[key];
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setPins(cached.data);
      return;
    }

    setLoadingPins(true);
    try {
      const radiusM = regionToRadiusMeters(region);
      const { data, error } = await supabase.rpc('eateries_near', {
        lat: region.latitude,
        lng: region.longitude,
        radius_m: radiusM,
      });
      if (error) throw error;

      const result = (data ?? []) as EateryPin[];
      pinCacheRef.current[key] = { data: result, ts: Date.now() };
      setPins(result);
    } catch (e) {
      logger.error('Failed to fetch map pins', e);
    } finally {
      setLoadingPins(false);
    }
  }

  function onRegionChangeComplete(region: Region) {
    regionRef.current = region;
    if (regionTimer.current) clearTimeout(regionTimer.current);
    regionTimer.current = setTimeout(() => fetchPins(region), 500);
  }

  // ── Pin tap ───────────────────────────────────────────────────────────────

  function onPinPress(pin: EateryPin) {
    setSelectedPin(pin);
    setLongPressCoord(null);

    // Resolve sheet detail from cached friend data
    const count = friendData.countMap[pin.id] ?? 0;
    const topDish = friendData.topDishMap[pin.id] ?? null;
    const avatars = friendData.avatarMap[pin.id] ?? [];
    setSheetDetail({ friendCount: count, topDish, friendAvatars: avatars });

    sheetRef.current?.snapToIndex(0);
  }

  function onSheetChange(index: number) {
    if (index === -1) setSelectedPin(null);
  }

  // ── Long-press ────────────────────────────────────────────────────────────

  function onLongPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    setLongPressCoord(e.nativeEvent.coordinate);
    sheetRef.current?.close();
  }

  function confirmAddEatery() {
    if (!longPressCoord) return;
    setLongPressCoord(null);
    router.push(
      `/eatery/add?lat=${longPressCoord.latitude.toFixed(6)}&lng=${longPressCoord.longitude.toFixed(6)}`,
    );
  }

  // ── Computed values ───────────────────────────────────────────────────────

  const clustered = useMemo(
    () => clusterPins(pins, regionRef.current.latitudeDelta),
    [pins],
  );

  const backdropComponent = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.3} />
    ),
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={s.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        onRegionChangeComplete={onRegionChangeComplete}
        onLongPress={onLongPress}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        rotateEnabled={false}
        moveOnMarkerPress={false}
      >
        {/* Heatmap layer — friends mode only */}
        {mode === 'friends' && friendData.heatPoints.length > 0 && (
          <Heatmap
            points={friendData.heatPoints}
            radius={40}
            opacity={0.7}
            gradient={{
              colors: [theme.PRIMARY_LIGHT, theme.PRIMARY],
              startPoints: [0.1, 1.0],
              colorMapSize: 256,
            }}
          />
        )}

        {/* Eatery pins */}
        {clustered.map((pin) => {
          const isCluster = pin.clusterCount > 1;
          const avatars = friendData.avatarMap[pin.id] ?? [];
          const friendCount = friendData.countMap[pin.id] ?? 0;
          const extraFriends = Math.max(0, friendCount - 3);
          const hasPulse = friendCount >= 3;

          if (isCluster) {
            return (
              <Marker
                key={`cluster-${pin.id}`}
                coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                tracksViewChanges={false}
                onPress={() => {
                  // Zoom in on cluster tap
                  mapRef.current?.animateToRegion({
                    latitude: pin.latitude,
                    longitude: pin.longitude,
                    latitudeDelta: regionRef.current.latitudeDelta * 0.5,
                    longitudeDelta: regionRef.current.longitudeDelta * 0.5,
                  }, 300);
                }}
              >
                <ClusterMarkerView count={pin.clusterCount} />
              </Marker>
            );
          }

          return (
            <Marker
              key={pin.id}
              coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
              tracksViewChanges={false}
              onPress={() => onPinPress(pin)}
            >
              <EateryMarkerView
                pin={pin}
                friendAvatars={avatars.slice(0, 3)}
                extraFriends={extraFriends}
                pulse={pulseAnim}
                hasPulse={hasPulse}
              />
            </Marker>
          );
        })}
      </MapView>

      {/* Floating toggle bar */}
      <View style={s.toggleWrap} pointerEvents="box-none">
        <ToggleBar mode={mode} onToggle={setMode} />
      </View>

      {/* Loading indicator */}
      {loadingPins && (
        <View style={s.loadingBadge} pointerEvents="none">
          <ActivityIndicator size="small" color={theme.PRIMARY} />
        </View>
      )}

      {/* Long-press action bar */}
      {longPressCoord && (
        <LongPressBar
          coord={longPressCoord}
          onConfirm={confirmAddEatery}
          onDismiss={() => setLongPressCoord(null)}
        />
      )}

      {/* Eatery bottom sheet */}
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={SHEET_SNAP_POINTS}
        enablePanDownToClose
        onChange={onSheetChange}
        backdropComponent={backdropComponent}
        handleIndicatorStyle={s.sheetHandle}
        backgroundStyle={s.sheetBg}
      >
        {selectedPin && (
          <BottomSheetView style={s.sheetContent}>
            {/* Photo */}
            {selectedPin.photos?.[0] ? (
              <Image
                source={{ uri: selectedPin.photos[0] }}
                style={s.sheetPhoto}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[s.sheetPhoto, s.sheetPhotoPlaceholder]}>
                <Ionicons name="restaurant-outline" size={36} color={theme.BORDER} />
              </View>
            )}

            {/* Info */}
            <View style={s.sheetInfo}>
              <Text style={s.sheetName}>{selectedPin.name}</Text>
              <Text style={s.sheetLocation}>{selectedPin.location_text}</Text>

              {sheetDetail && sheetDetail.friendCount > 0 && (
                <Text style={s.sheetFriends}>
                  {sheetDetail.friendCount} {sheetDetail.friendCount === 1 ? 'friend' : 'friends'} reviewed this
                </Text>
              )}

              {sheetDetail?.topDish && (
                <Text style={s.sheetDish}>"{sheetDetail.topDish}"</Text>
              )}

              {/* CTA buttons */}
              <View style={s.sheetBtns}>
                <Pressable
                  style={s.sheetBtnFilled}
                  onPress={() => {
                    sheetRef.current?.close();
                    router.push(`/eatery/${selectedPin.id}`);
                  }}
                >
                  <Text style={s.sheetBtnFilledText}>View eatery</Text>
                </Pressable>
                <Pressable
                  style={s.sheetBtnOutline}
                  onPress={() => {
                    sheetRef.current?.close();
                    router.push(
                      `/eatery/review?eateryId=${selectedPin.id}&eateryName=${encodeURIComponent(selectedPin.name)}`,
                    );
                  }}
                >
                  <Text style={s.sheetBtnOutlineText}>Leave review</Text>
                </Pressable>
              </View>
            </View>
          </BottomSheetView>
        )}
      </BottomSheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },

  // Toggle bar
  toggleWrap: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // Loading badge
  loadingBadge: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 999,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  // Bottom sheet
  sheetBg: { backgroundColor: '#fff', borderRadius: 20 },
  sheetHandle: { backgroundColor: theme.BORDER, width: 36, height: 4 },
  sheetContent: { flex: 1 },
  sheetPhoto: {
    width: '100%',
    height: 140,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  sheetPhotoPlaceholder: {
    backgroundColor: theme.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetInfo: { padding: 16, gap: 6 },
  sheetName: { fontSize: 18, fontWeight: '800', color: theme.TEXT, letterSpacing: -0.3 },
  sheetLocation: { fontSize: 13, color: theme.MUTED },
  sheetFriends: { fontSize: 13, color: theme.PRIMARY, fontWeight: '600' },
  sheetDish: { fontSize: 13, color: theme.MUTED, fontStyle: 'italic' },
  sheetBtns: { flexDirection: 'column', gap: 8, marginTop: 8 },
  sheetBtnFilled: {
    height: 46,
    borderRadius: 999,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnFilledText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  sheetBtnOutline: {
    height: 46,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnOutlineText: { fontSize: 15, fontWeight: '700', color: theme.PRIMARY },
});

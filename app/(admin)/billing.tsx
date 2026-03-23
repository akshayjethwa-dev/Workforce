// app/(admin)/billing.tsx
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function BillingScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Billing</Text>
        <Text style={styles.headerSub}>Manage your subscription & invoices</Text>
      </View>

      {/* Current Plan Card */}
      <View style={styles.planCard}>
        <View style={styles.planCardTop}>
          <View style={styles.planBadge}>
            <Ionicons name="flash-outline" size={14} color="#7C3AED" />
            <Text style={styles.planBadgeText}>Current Plan</Text>
          </View>
          <Text style={styles.planName}>Free Plan</Text>
          <Text style={styles.planPrice}>₹0 <Text style={styles.planPeriod}>/ month</Text></Text>
        </View>
        <View style={styles.planDivider} />
        <View style={styles.planFeatures}>
          {[
            'Up to 10 workers',
            'Basic attendance tracking',
            'Monthly payroll summary',
            'Standard reports',
          ].map((f) => (
            <View key={f} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={16} color="#15803D" />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Upgrade Banner */}
      <View style={styles.upgradeBanner}>
        <View style={styles.upgradeBannerLeft}>
          <Ionicons name="rocket-outline" size={28} color="#4F46E5" />
          <View>
            <Text style={styles.upgradeTitle}>Upgrade to Pro</Text>
            <Text style={styles.upgradeSub}>Unlock advances, ID cards, team management & more</Text>
          </View>
        </View>
        <View style={styles.upgradeBtn}>
          <Text style={styles.upgradeBtnText}>Coming Soon</Text>
        </View>
      </View>

      {/* Invoice section placeholder */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Invoices</Text>
        <View style={styles.emptyBox}>
          <Ionicons name="receipt-outline" size={40} color="#D1D5DB" />
          <Text style={styles.emptyText}>No invoices yet</Text>
          <Text style={styles.emptySubText}>Your billing history will appear here.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F9FAFB' },
  content:     { paddingBottom: 60 },

  header:      { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  headerSub:   { fontSize: 12, color: '#6B7280', marginTop: 2 },

  // Plan card
  planCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E0E7FF',
    overflow: 'hidden',
    shadowColor: '#4F46E5',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  planCardTop:   { padding: 20 },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#EDE9FE',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 10,
  },
  planBadgeText: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },
  planName:      { fontSize: 18, fontWeight: '900', color: '#111827', marginBottom: 4 },
  planPrice:     { fontSize: 26, fontWeight: '900', color: '#4F46E5' },
  planPeriod:    { fontSize: 14, fontWeight: '400', color: '#6B7280' },
  planDivider:   { height: 1, backgroundColor: '#F3F4F6' },
  planFeatures:  { padding: 16, gap: 10 },
  featureRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText:   { fontSize: 13, color: '#374151', fontWeight: '500' },

  // Upgrade banner
  upgradeBanner: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: '#EEF2FF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    padding: 16,
    gap: 12,
  },
  upgradeBannerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  upgradeTitle:      { fontSize: 14, fontWeight: '800', color: '#3730A3' },
  upgradeSub:        { fontSize: 11, color: '#6366F1', marginTop: 2, lineHeight: 16 },
  upgradeBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  upgradeBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Invoices
  section:        { paddingHorizontal: 16 },
  sectionTitle:   { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 12 },
  emptyBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    padding: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyText:    { fontSize: 14, fontWeight: '700', color: '#6B7280' },
  emptySubText: { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },
});

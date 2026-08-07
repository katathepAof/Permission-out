(function () {
  'use strict';

  const ROOT = 'กฟฉ.2';
  const topOffices = new Map();
  const branchParents = new Map();
  const childParents = new Map();
  const confirmedChildren = new Set(['สามชัย', 'คำม่วง', 'นาคู', 'ห้วยผึ้ง', 'นามน', 'เขาวง']);

  function addTop(level, province, ...names) {
    names.forEach(name => topOffices.set(name, { level, name, province }));
  }
  function addBranches(parentLevel, parentName, ...names) {
    names.forEach(name => branchParents.set(name, { parentLevel, parentName }));
  }
  function addChildren(parentLevel, parentName, ...names) {
    names.forEach(name => childParents.set(name, { parentLevel, parentName }));
  }

  addTop('กฟจ.', 'อุบลราชธานี', 'อุบลราชธานี');
  addTop('กฟอ.', 'อุบลราชธานี', 'เดชอุดม', 'วารินชำราบ', 'ตระการพืชผล');
  addBranches('กฟจ.', 'อุบลราชธานี', 'ม่วงสามสิบ', 'เขื่องใน');
  addBranches('กฟอ.', 'เดชอุดม', 'น้ำยืน', 'บุณฑริก');
  addBranches('กฟอ.', 'วารินชำราบ', 'พิบูลมังสาหาร');
  addBranches('กฟอ.', 'ตระการพืชผล', 'เขมราฐ');
  addChildren('กฟส.', 'เขมราฐ', 'ศรีเมืองใหม่', 'โพธิ์ไทร', 'นาตาล');
  addChildren('กฟส.', 'พิบูลมังสาหาร', 'โขงเจียม', 'ตาลสุม', 'สิรินธร');
  addChildren('กฟส.', 'บุณฑริก', 'นาจะหลวย');
  addChildren('กฟอ.', 'ตระการพืชผล', 'กุดข้าวปุ้น');
  addChildren('กฟอ.', 'เดชอุดม', 'สำโรง', 'ทุ่งศรีอุดม', 'นาเยีย');
  addChildren('กฟจ.', 'อุบลราชธานี', 'ดอนมดแดง');
  addChildren('กฟส.', 'ม่วงสามสิบ', 'เหล่าเสือโก้ก');
  addChildren('กฟอ.', 'วารินชำราบ', 'สว่างวีระวงศ์');
  addChildren('กฟส.', 'น้ำยืน', 'น้ำขุ่น');

  addTop('กฟจ.', 'ศรีสะเกษ', 'ศรีสะเกษ');
  addTop('กฟอ.', 'ศรีสะเกษ', 'กันทรลักษ์');
  addBranches('กฟจ.', 'ศรีสะเกษ', 'อุทุมพรพิสัย', 'ราษีไศล', 'กันทรารมย์');
  addBranches('กฟอ.', 'กันทรลักษ์', 'ขุขันธ์', 'ขุนหาญ');
  addChildren('กฟจ.', 'ศรีสะเกษ', 'ยางชุมน้อย', 'วังหิน', 'พยุห์');
  addChildren('กฟส.', 'ขุขันธ์', 'ไพรบึง', 'ภูสิงห์');
  addChildren('กฟส.', 'อุทุมพรพิสัย', 'ปรางค์กู่', 'ห้วยทับทัน', 'เมืองจันทร์');
  addChildren('กฟส.', 'ราษีไศล', 'บึงบูรพ์', 'โพธิ์ศรีสุวรรณ', 'ศิลาลาด');
  addChildren('กฟอ.', 'กันทรลักษ์', 'โนนคูณ', 'ศรีรัตนะ', 'เบญจลักษ์');
  addChildren('กฟส.', 'กันทรารมย์', 'น้ำเกลี้ยง');

  addTop('กฟจ.', 'ยโสธร', 'ยโสธร');
  addBranches('กฟจ.', 'ยโสธร', 'มหาชนะชัย', 'เลิงนกทา');
  addChildren('กฟจ.', 'ยโสธร', 'ทรายมูล', 'คำเขื่อนแก้ว');
  addChildren('กฟส.', 'เลิงนกทา', 'กุดชุม', 'ป่าติ้ว', 'ไทยเจริญ');
  addChildren('กฟส.', 'มหาชนะชัย', 'ค้อวัง');

  addTop('กฟจ.', 'อำนาจเจริญ', 'อำนาจเจริญ');
  addChildren('กฟจ.', 'อำนาจเจริญ', 'ชานุมาน', 'ปทุมราชวงศา', 'พนา', 'เสนางคนิคม', 'หัวตะพาน', 'ลืออำนาจ');

  addTop('กฟจ.', 'ร้อยเอ็ด', 'ร้อยเอ็ด');
  addTop('กฟอ.', 'ร้อยเอ็ด', 'เสลภูมิ');
  addBranches('กฟจ.', 'ร้อยเอ็ด', 'พนมไพร', 'สุวรรณภูมิ', 'เกษตรวิสัย', 'อาจสามารถ');
  addBranches('กฟอ.', 'เสลภูมิ', 'โพนทอง');
  addChildren('กฟส.', 'สุวรรณภูมิ', 'ปทุมรัตต์', 'โพนทราย', 'หนองฮี');
  addChildren('กฟจ.', 'ร้อยเอ็ด', 'ธวัชบุรี', 'จตุรพักตรพิมาน', 'ศรีสมเด็จ', 'เชียงขวัญ', 'เมืองสรวง', 'จังหาร');
  addChildren('กฟส.', 'โพนทอง', 'โพธิ์ชัย', 'หนองพอก', 'เมยวดี');
  addChildren('กฟอ.', 'เสลภูมิ', 'ทุ่งเขาหลวง');

  addTop('กฟจ.', 'มหาสารคาม', 'มหาสารคาม');
  addTop('กฟอ.', 'มหาสารคาม', 'พยัคฆภูมิพิสัย');
  addBranches('กฟจ.', 'มหาสารคาม', 'โกสุมพิสัย', 'บรบือ', 'เชียงยืน', 'กันทรวิชัย');
  addBranches('กฟอ.', 'พยัคฆภูมิพิสัย', 'วาปีปทุม');
  addChildren('กฟจ.', 'มหาสารคาม', 'แกดำ');
  addChildren('กฟส.', 'บรบือ', 'นาเชือก', 'กุดรัง');
  addChildren('กฟอ.', 'พยัคฆภูมิพิสัย', 'นาดูน', 'ยางสีสุราช');
  addChildren('กฟส.', 'เชียงยืน', 'ชื่นชม');

  addTop('กฟจ.', 'กาฬสินธุ์', 'กาฬสินธุ์');
  addTop('กฟอ.', 'กาฬสินธุ์', 'สมเด็จ');
  addBranches('กฟจ.', 'กาฬสินธุ์', 'ยางตลาด', 'หนองกุงศรี');
  addBranches('กฟอ.', 'สมเด็จ', 'กุฉินารายณ์');
  addChildren('กฟอ.', 'สมเด็จ', 'นามน', 'คำม่วง', 'สามชัย', 'นาคู', 'ห้วยผึ้ง', 'เขาวง');
  addChildren('กฟจ.', 'กาฬสินธุ์', 'กมลาไสย', 'ร่องคำ', 'สหัสขันธ์', 'ดอนจาน', 'ฆ้องชัย');
  addChildren('กฟส.', 'หนองกุงศรี', 'ท่าคันโท', 'ห้วยเม็ก');

  addTop('กฟจ.', 'มุกดาหาร', 'มุกดาหาร');
  addBranches('กฟจ.', 'มุกดาหาร', 'คำชะอี');
  addChildren('กฟจ.', 'มุกดาหาร', 'นิคมคำสร้อย', 'ดอนตาล', 'ดงหลวง', 'หว้านใหญ่');
  addChildren('กฟส.', 'คำชะอี', 'หนองสูง');

  const knownNames = [...new Set([...topOffices.keys(), ...branchParents.keys(), ...childParents.keys()])]
    .sort((left, right) => right.length - left.length);
  const compact = value => String(value || '').replace(/\s+/g, '').replace(/อำเภอ|จังหวัด|การไฟฟ้าส่วนภูมิภาค|สาขาย่อย|สาขา/g, '');
  function knownName(areaName) {
    const value = compact(areaName);
    return knownNames.find(name => value.includes(compact(name))) || '';
  }
  function label(level, name) { return `${level}${name}`; }
  function topFor(level, name) {
    if (level === 'กฟจ.' || level === 'กฟอ.') return { level, name };
    const branch = branchParents.get(name);
    return branch ? { level: branch.parentLevel, name: branch.parentName } : null;
  }
  function resolve(area) {
    const rawName = String(area?.name || '').trim();
    const name = knownName(rawName);
    if (!name) return { key: `other>${rawName || 'unknown'}`, path: ['พื้นที่ PEA อื่น', rawName || 'ไม่พบพื้นที่ PEA'], confirmed: false };
    const top = topOffices.get(name);
    if (top) return { key: `${ROOT}>${label(top.level, name)}`, path: [ROOT, label(top.level, name)], confirmed: true };
    const branch = branchParents.get(name);
    if (branch) return { key: `${ROOT}>${label(branch.parentLevel, branch.parentName)}>${label('กฟส.', name)}`, path: [ROOT, label(branch.parentLevel, branch.parentName), label('กฟส.', name)], confirmed: true };
    const child = childParents.get(name);
    const parentTop = topFor(child.parentLevel, child.parentName);
    const confirmed = confirmedChildren.has(name);
    const leaf = `${label('กฟย.', name)}${confirmed ? '' : ' (รอยืนยัน)'}`;
    const path = [ROOT];
    if (parentTop) path.push(label(parentTop.level, parentTop.name));
    if (child.parentLevel === 'กฟส.') path.push(label('กฟส.', child.parentName));
    path.push(leaf);
    return { key: path.join('>'), path, confirmed };
  }

  window.permissionOutPeaHierarchyForArea = resolve;
})();

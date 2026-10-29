// Popular medicines in Pakistan, for a first-run import. NO PRICES: the pharmacy enters MRP and cost itself.
//
// Each row: [brand, salt (generic), company, strength, form, pack, class]
//   pack   letter + units per pack: S = strip, B = bottle, T = tube, V = vial, A = ampoule, I = inhaler,
//          X = box, P = piece. Example: S10 = strip of 10 tablets, B1 = one bottle.
//   class  otc | rx | controlled | general
//   Insulin and a few biologics are stored in the fridge (see storageFor below).
//
// Brands, companies and packs come from general knowledge of the market. Check them against your
// supplier's catalogue before relying on them, and edit the medicine if it differs.
export const POPULAR_MEDICINES = [
  // Analgesics and antipyretics
  ['Panadol', 'Paracetamol', 'GSK', '500mg', 'tablet', 'S10', 'otc'],
  ['Panadol Extra', 'Paracetamol + Caffeine', 'GSK', '500mg + 65mg', 'tablet', 'S10', 'otc'],
  ['Calpol', 'Paracetamol', 'GSK', '120mg/5ml', 'syrup', 'B1', 'otc'],
  ['Calpol Infant Drops', 'Paracetamol', 'GSK', '100mg/ml', 'drops', 'B1', 'otc'],
  ['Disprin', 'Aspirin', 'Reckitt', '300mg', 'tablet', 'S10', 'otc'],
  ['Brufen', 'Ibuprofen', 'Abbott', '400mg', 'tablet', 'S10', 'otc'],
  ['Brufen Syrup', 'Ibuprofen', 'Abbott', '100mg/5ml', 'syrup', 'B1', 'otc'],
  ['Ponstan', 'Mefenamic acid', 'Pfizer', '250mg', 'capsule', 'S10', 'otc'],
  ['Ponstan Forte', 'Mefenamic acid', 'Pfizer', '500mg', 'capsule', 'S10', 'otc'],
  ['Voltaren', 'Diclofenac sodium', 'Novartis', '50mg', 'tablet', 'S10', 'rx'],
  ['Voltaren Gel', 'Diclofenac sodium', 'Novartis', '1%', 'gel', 'T1', 'otc'],
  ['Voltaren Injection', 'Diclofenac sodium', 'Novartis', '75mg/3ml', 'injection', 'V1', 'rx'],
  ['Cataflam', 'Diclofenac potassium', 'Novartis', '50mg', 'tablet', 'S10', 'rx'],
  ['Celebrex', 'Celecoxib', 'Pfizer', '200mg', 'capsule', 'S10', 'rx'],
  ['Naprosyn', 'Naproxen', 'Roche', '500mg', 'tablet', 'S10', 'rx'],
  ['Feldene', 'Piroxicam', 'Pfizer', '20mg', 'capsule', 'S10', 'rx'],
  ['Myoril', 'Thiocolchicoside', 'Sanofi', '4mg', 'tablet', 'S10', 'rx'],
  ['Tramal', 'Tramadol', 'Grunenthal', '50mg', 'capsule', 'S10', 'controlled'],
  ['Ultracet', 'Tramadol + Paracetamol', 'Janssen', '37.5mg + 325mg', 'tablet', 'S10', 'controlled'],
  ['Ketorolac Injection', 'Ketorolac', 'Generic', '30mg/ml', 'injection', 'V1', 'rx'],
  ['Paracetamol Tablet', 'Paracetamol', 'Generic', '500mg', 'tablet', 'S10', 'otc'],
  ['Paracetamol Syrup', 'Paracetamol', 'Generic', '125mg/5ml', 'syrup', 'B1', 'otc'],
  ['Ibuprofen Syrup', 'Ibuprofen', 'Generic', '100mg/5ml', 'syrup', 'B1', 'otc'],
  ['Naproxen Tablet', 'Naproxen', 'Generic', '250mg', 'tablet', 'S10', 'rx'],
  ['Colchicine', 'Colchicine', 'Generic', '0.5mg', 'tablet', 'S10', 'rx'],
  ['Allopurinol', 'Allopurinol', 'Generic', '100mg', 'tablet', 'S10', 'rx'],

  // Antibiotics
  ['Augmentin', 'Amoxicillin + Clavulanic acid', 'GSK', '625mg', 'tablet', 'S6', 'rx'],
  ['Augmentin Syrup', 'Amoxicillin + Clavulanic acid', 'GSK', '156mg/5ml', 'suspension', 'B1', 'rx'],
  ['Augmentin Forte', 'Amoxicillin + Clavulanic acid', 'GSK', '1000mg', 'tablet', 'S6', 'rx'],
  ['Amoxil', 'Amoxicillin', 'GSK', '500mg', 'capsule', 'S10', 'rx'],
  ['Amoxil Syrup', 'Amoxicillin', 'GSK', '250mg/5ml', 'suspension', 'B1', 'rx'],
  ['Ciproxin', 'Ciprofloxacin', 'Bayer', '500mg', 'tablet', 'S10', 'rx'],
  ['Ciprofloxacin', 'Ciprofloxacin', 'Generic', '500mg', 'tablet', 'S10', 'rx'],
  ['Levoflox', 'Levofloxacin', 'Generic', '500mg', 'tablet', 'S5', 'rx'],
  ['Flagyl', 'Metronidazole', 'Sanofi', '400mg', 'tablet', 'S10', 'rx'],
  ['Flagyl Suspension', 'Metronidazole', 'Sanofi', '200mg/5ml', 'suspension', 'B1', 'rx'],
  ['Metronidazole', 'Metronidazole', 'Generic', '400mg', 'tablet', 'S10', 'rx'],
  ['Zithromax', 'Azithromycin', 'Pfizer', '500mg', 'tablet', 'S3', 'rx'],
  ['Azithromycin', 'Azithromycin', 'Generic', '500mg', 'tablet', 'S3', 'rx'],
  ['Azithromycin Syrup', 'Azithromycin', 'Generic', '200mg/5ml', 'suspension', 'B1', 'rx'],
  ['Klacid', 'Clarithromycin', 'Abbott', '500mg', 'tablet', 'S10', 'rx'],
  ['Doxycycline', 'Doxycycline', 'Generic', '100mg', 'capsule', 'S10', 'rx'],
  ['Cefixime', 'Cefixime', 'Generic', '200mg', 'capsule', 'S10', 'rx'],
  ['Cefuroxime', 'Cefuroxime axetil', 'Generic', '500mg', 'tablet', 'S10', 'rx'],
  ['Ceftriaxone Injection', 'Ceftriaxone', 'Generic', '1g', 'injection', 'V1', 'rx'],
  ['Gentamicin Injection', 'Gentamicin', 'Generic', '80mg/2ml', 'injection', 'V1', 'rx'],
  ['Amikacin Injection', 'Amikacin', 'Generic', '500mg/2ml', 'injection', 'V1', 'rx'],
  ['Nitrofurantoin', 'Nitrofurantoin', 'Generic', '100mg', 'capsule', 'S10', 'rx'],
  ['Tinidazole', 'Tinidazole', 'Generic', '500mg', 'tablet', 'S2', 'rx'],
  ['Clindamycin', 'Clindamycin', 'Generic', '300mg', 'capsule', 'S10', 'rx'],
  ['Cotrimoxazole', 'Sulfamethoxazole + Trimethoprim', 'Generic', '480mg', 'tablet', 'S20', 'rx'],

  // Antifungal and antiparasitic
  ['Diflucan', 'Fluconazole', 'Pfizer', '150mg', 'capsule', 'S1', 'rx'],
  ['Fluconazole', 'Fluconazole', 'Generic', '150mg', 'capsule', 'S1', 'rx'],
  ['Canesten Cream', 'Clotrimazole', 'Bayer', '1%', 'cream', 'T1', 'otc'],
  ['Fucidin Cream', 'Fusidic acid', 'LEO', '2%', 'cream', 'T1', 'rx'],
  ['Mebex', 'Mebendazole', 'Janssen', '100mg', 'tablet', 'S1', 'rx'],
  ['Albenza', 'Albendazole', 'Eisai', '400mg', 'tablet', 'S1', 'rx'],
  ['Stromectol', 'Ivermectin', 'MSD', '3mg', 'tablet', 'S4', 'rx'],
  ['Ivermectin', 'Ivermectin', 'Generic', '6mg', 'tablet', 'S4', 'rx'],

  // Gastro-intestinal
  ['Nexium', 'Esomeprazole', 'AstraZeneca', '40mg', 'capsule', 'S7', 'rx'],
  ['Omeprazole', 'Omeprazole', 'Generic', '20mg', 'capsule', 'S10', 'rx'],
  ['Pantoprazole', 'Pantoprazole', 'Generic', '40mg', 'tablet', 'S10', 'rx'],
  ['Pantoprazole Injection', 'Pantoprazole', 'Generic', '40mg', 'injection', 'V1', 'rx'],
  ['Famotidine', 'Famotidine', 'Generic', '20mg', 'tablet', 'S10', 'rx'],
  ['Motilium', 'Domperidone', 'Janssen', '10mg', 'tablet', 'S10', 'rx'],
  ['Primperan', 'Metoclopramide', 'Sanofi', '10mg', 'tablet', 'S10', 'rx'],
  ['Ondansetron Injection', 'Ondansetron', 'Generic', '4mg/2ml', 'injection', 'V1', 'rx'],
  ['Buscopan', 'Hyoscine butylbromide', 'Boehringer Ingelheim', '10mg', 'tablet', 'S10', 'rx'],
  ['Dicyclomine', 'Dicyclomine', 'Generic', '10mg', 'tablet', 'S10', 'rx'],
  ['Dulcolax', 'Bisacodyl', 'Boehringer Ingelheim', '5mg', 'tablet', 'S10', 'otc'],
  ['Lactulose Syrup', 'Lactulose', 'Generic', '3.35g/5ml', 'syrup', 'B1', 'rx'],
  ['Imodium', 'Loperamide', 'Janssen', '2mg', 'capsule', 'S10', 'otc'],
  ['Gaviscon', 'Sodium alginate + Sodium bicarbonate', 'Reckitt', 'Liquid', 'syrup', 'B1', 'otc'],
  ['Hydrosol ORS', 'Oral rehydration salts', 'Searle', 'Sachet', 'powder', 'P1', 'otc'],
  ['Ranitidine', 'Ranitidine', 'Generic', '150mg', 'tablet', 'S10', 'rx'],

  // Antihistamines and cold
  ['Telfast', 'Fexofenadine', 'Sanofi', '120mg', 'tablet', 'S10', 'otc'],
  ['Zyrtec', 'Cetirizine', 'UCB', '10mg', 'tablet', 'S10', 'otc'],
  ['Cetirizine', 'Cetirizine', 'Generic', '10mg', 'tablet', 'S10', 'otc'],
  ['Cetirizine Syrup', 'Cetirizine', 'Generic', '5mg/5ml', 'syrup', 'B1', 'otc'],
  ['Loratadine', 'Loratadine', 'Generic', '10mg', 'tablet', 'S10', 'otc'],
  ['Avil', 'Pheniramine maleate', 'Sanofi', '25mg', 'tablet', 'S10', 'otc'],
  ['Phenergan', 'Promethazine', 'Sanofi', '25mg', 'tablet', 'S10', 'rx'],
  ['Otrivin Nasal Spray', 'Xylometazoline', 'Novartis', '0.1%', 'spray', 'B1', 'otc'],
  ['Strepsils', 'Amylmetacresol + Dichlorobenzyl alcohol', 'Reckitt', 'Lozenge', 'other', 'S8', 'otc'],
  ['Benadryl Syrup', 'Diphenhydramine', 'Generic', '12.5mg/5ml', 'syrup', 'B1', 'otc'],
  ['Mucosolvan Syrup', 'Ambroxol', 'Boehringer Ingelheim', '30mg/5ml', 'syrup', 'B1', 'otc'],
  ['Bisolvon', 'Bromhexine', 'Boehringer Ingelheim', '8mg', 'tablet', 'S10', 'otc'],
  ['Ambroxol', 'Ambroxol', 'Generic', '30mg', 'tablet', 'S10', 'rx'],
  ['Theophylline', 'Theophylline', 'Generic', '200mg', 'tablet', 'S10', 'rx'],

  // Respiratory
  ['Ventolin Inhaler', 'Salbutamol', 'GSK', '100mcg/dose', 'inhaler', 'I1', 'rx'],
  ['Seretide Inhaler', 'Salmeterol + Fluticasone', 'GSK', '125mcg/25mcg', 'inhaler', 'I1', 'rx'],
  ['Berodual Inhaler', 'Ipratropium + Fenoterol', 'Boehringer Ingelheim', '20mcg/50mcg', 'inhaler', 'I1', 'rx'],
  ['Singulair', 'Montelukast', 'MSD', '10mg', 'tablet', 'S14', 'rx'],
  ['Montelukast', 'Montelukast', 'Generic', '10mg', 'tablet', 'S10', 'rx'],

  // Vitamins and supplements
  ['Cevit', 'Ascorbic acid', 'Generic', '500mg', 'tablet', 'S10', 'otc'],
  ['Becosules', 'Vitamin B complex + C', 'Pfizer', 'Capsule', 'capsule', 'S10', 'otc'],
  ['Caltrate', 'Calcium + Vitamin D3', 'Pfizer', '600mg + 400IU', 'tablet', 'S10', 'otc'],
  ['Surbex Z', 'Vitamin B complex + Zinc', 'Abbott', 'Capsule', 'capsule', 'S10', 'otc'],
  ['Neurobion', 'Vitamin B1 + B6 + B12', 'Merck', 'Tablet', 'tablet', 'S10', 'otc'],
  ['Neurobion Injection', 'Cyanocobalamin + Thiamine + Pyridoxine', 'Merck', '2ml', 'injection', 'A1', 'rx'],
  ['Cyanocobalamin Injection', 'Cyanocobalamin', 'Generic', '1000mcg/ml', 'injection', 'V1', 'rx'],
  ['Centrum', 'Multivitamin + Minerals', 'Pfizer', 'Tablet', 'tablet', 'S10', 'otc'],
  ['Abidec Drops', 'Multivitamin', 'Pfizer', 'Drops', 'drops', 'B1', 'otc'],
  ['Ferrous Fumarate', 'Ferrous fumarate + Folic acid', 'Generic', '200mg', 'tablet', 'S10', 'otc'],
  ['Folic Acid', 'Folic acid', 'Generic', '5mg', 'tablet', 'S10', 'otc'],
  ['Vitamin D3 Drops', 'Cholecalciferol', 'Generic', '400IU/drop', 'drops', 'B1', 'otc'],
  ['Omega-3 Fish Oil', 'Omega-3 fatty acids', 'Generic', '1000mg', 'capsule', 'S10', 'otc'],
  ['Glucon-D', 'Glucose', 'Generic', 'Powder', 'powder', 'P1', 'otc'],

  // Diabetes
  ['Glucophage', 'Metformin', 'Merck', '500mg', 'tablet', 'S10', 'rx'],
  ['Glucophage XR', 'Metformin', 'Merck', '500mg', 'tablet', 'S10', 'rx'],
  ['Metformin', 'Metformin', 'Generic', '850mg', 'tablet', 'S10', 'rx'],
  ['Diamicron', 'Gliclazide', 'Servier', '80mg', 'tablet', 'S10', 'rx'],
  ['Gliclazide', 'Gliclazide', 'Generic', '80mg', 'tablet', 'S10', 'rx'],
  ['Amaryl', 'Glimepiride', 'Sanofi', '2mg', 'tablet', 'S10', 'rx'],
  ['Januvia', 'Sitagliptin', 'MSD', '100mg', 'tablet', 'S14', 'rx'],
  ['Glucobay', 'Acarbose', 'Bayer', '50mg', 'tablet', 'S10', 'rx'],
  ['Lantus Solostar', 'Insulin glargine', 'Sanofi', '100 IU/ml', 'injection', 'A1', 'rx'],
  ['Mixtard 30', 'Human insulin (30:70)', 'Novo Nordisk', '100 IU/ml', 'injection', 'V1', 'rx'],
  ['Actrapid', 'Human insulin (regular)', 'Novo Nordisk', '100 IU/ml', 'injection', 'V1', 'rx'],

  // Cardiovascular
  ['Norvasc', 'Amlodipine', 'Pfizer', '5mg', 'tablet', 'S14', 'rx'],
  ['Amlodipine', 'Amlodipine', 'Generic', '5mg', 'tablet', 'S14', 'rx'],
  ['Cozaar', 'Losartan', 'MSD', '50mg', 'tablet', 'S14', 'rx'],
  ['Losartan', 'Losartan', 'Generic', '50mg', 'tablet', 'S14', 'rx'],
  ['Tenormin', 'Atenolol', 'AstraZeneca', '50mg', 'tablet', 'S14', 'rx'],
  ['Atenolol', 'Atenolol', 'Generic', '50mg', 'tablet', 'S14', 'rx'],
  ['Concor', 'Bisoprolol', 'Merck', '5mg', 'tablet', 'S14', 'rx'],
  ['Lipitor', 'Atorvastatin', 'Pfizer', '20mg', 'tablet', 'S14', 'rx'],
  ['Atorvastatin', 'Atorvastatin', 'Generic', '10mg', 'tablet', 'S14', 'rx'],
  ['Crestor', 'Rosuvastatin', 'AstraZeneca', '10mg', 'tablet', 'S14', 'rx'],
  ['Caduet', 'Amlodipine + Atorvastatin', 'Pfizer', '5mg + 10mg', 'tablet', 'S14', 'rx'],
  ['Plavix', 'Clopidogrel', 'Sanofi', '75mg', 'tablet', 'S14', 'rx'],
  ['Cardiprin', 'Aspirin', 'Generic', '75mg', 'tablet', 'S14', 'otc'],
  ['Lasix', 'Furosemide', 'Sanofi', '40mg', 'tablet', 'S10', 'rx'],
  ['Hydrochlorothiazide', 'Hydrochlorothiazide', 'Generic', '25mg', 'tablet', 'S14', 'rx'],
  ['Aldactone', 'Spironolactone', 'Pfizer', '25mg', 'tablet', 'S20', 'rx'],
  ['Lanoxin', 'Digoxin', 'GSK', '0.25mg', 'tablet', 'S10', 'rx'],
  ['Coversyl', 'Perindopril', 'Servier', '5mg', 'tablet', 'S30', 'rx'],
  ['Tritace', 'Ramipril', 'Sanofi', '5mg', 'capsule', 'S14', 'rx'],
  ['Nitrostat', 'Glyceryl trinitrate', 'Pfizer', '0.5mg', 'tablet', 'S10', 'rx'],
  ['Coumadin', 'Warfarin', 'Bristol-Myers Squibb', '5mg', 'tablet', 'S10', 'rx'],
  ['Heparin Injection', 'Heparin sodium', 'Generic', '5000 IU/ml', 'injection', 'V1', 'rx'],
  ['Clexane Injection', 'Enoxaparin', 'Sanofi', '40mg/0.4ml', 'injection', 'V1', 'rx'],

  // Neurology and psychiatry
  ['Epival', 'Sodium valproate', 'Abbott', '500mg', 'tablet', 'S10', 'rx'],
  ['Tegretol', 'Carbamazepine', 'Novartis', '200mg', 'tablet', 'S10', 'rx'],
  ['Lyrica', 'Pregabalin', 'Pfizer', '75mg', 'capsule', 'S14', 'rx'],
  ['Stugeron', 'Cinnarizine', 'Janssen', '25mg', 'tablet', 'S10', 'otc'],
  ['Sinemet', 'Carbidopa + Levodopa', 'MSD', '250mg/25mg', 'tablet', 'S10', 'rx'],
  ['Aricept', 'Donepezil', 'Eisai', '5mg', 'tablet', 'S14', 'rx'],
  ['Seroquel', 'Quetiapine', 'AstraZeneca', '25mg', 'tablet', 'S10', 'rx'],
  ['Risperdal', 'Risperidone', 'Janssen', '2mg', 'tablet', 'S10', 'rx'],
  ['Lexapro', 'Escitalopram', 'Generic', '10mg', 'tablet', 'S14', 'rx'],
  ['Prozac', 'Fluoxetine', 'Eli Lilly', '20mg', 'capsule', 'S14', 'rx'],
  ['Amitriptyline', 'Amitriptyline', 'Generic', '25mg', 'tablet', 'S10', 'rx'],
  ['Haloperidol', 'Haloperidol', 'Generic', '5mg', 'tablet', 'S10', 'rx'],
  ['Valium', 'Diazepam', 'Roche', '5mg', 'tablet', 'S10', 'controlled'],
  ['Xanax', 'Alprazolam', 'Pfizer', '0.5mg', 'tablet', 'S10', 'controlled'],
  ['Rivotril', 'Clonazepam', 'Roche', '0.5mg', 'tablet', 'S10', 'controlled'],
  ['Lexotanil', 'Bromazepam', 'Roche', '3mg', 'tablet', 'S10', 'controlled'],
  ['Codeine Phosphate', 'Codeine phosphate', 'Generic', '30mg', 'tablet', 'S10', 'controlled'],

  // Steroids and skin
  ['Medrol', 'Methylprednisolone', 'Pfizer', '4mg', 'tablet', 'S10', 'rx'],
  ['Prednisolone', 'Prednisolone', 'Generic', '5mg', 'tablet', 'S10', 'rx'],
  ['Dexamethasone', 'Dexamethasone', 'Generic', '0.5mg', 'tablet', 'S10', 'rx'],
  ['Dexamethasone Injection', 'Dexamethasone', 'Generic', '4mg/ml', 'injection', 'V1', 'rx'],
  ['Betnovate Cream', 'Betamethasone', 'GSK', '0.1%', 'cream', 'T1', 'rx'],
  ['Dermovate Cream', 'Clobetasol propionate', 'GSK', '0.05%', 'cream', 'T1', 'rx'],
  ['Hydrocortisone Cream', 'Hydrocortisone', 'Generic', '1%', 'cream', 'T1', 'otc'],
  ['Hydroxychloroquine', 'Hydroxychloroquine', 'Sanofi', '200mg', 'tablet', 'S10', 'rx'],
  ['Methotrexate', 'Methotrexate', 'Generic', '2.5mg', 'tablet', 'S10', 'rx'],
  ['Corsodyl Mouthwash', 'Chlorhexidine gluconate', 'GSK', '0.2%', 'other', 'B1', 'otc'],

  // Urology and women's health
  ['Flomax', 'Tamsulosin', 'Boehringer Ingelheim', '0.4mg', 'capsule', 'S10', 'rx'],
  ['Oxybutynin', 'Oxybutynin', 'Generic', '5mg', 'tablet', 'S10', 'rx'],
  ['Proscar', 'Finasteride', 'MSD', '5mg', 'tablet', 'S10', 'rx'],
  ['Duphaston', 'Dydrogesterone', 'Abbott', '10mg', 'tablet', 'S10', 'rx'],
  ['Primolut-N', 'Norethisterone', 'Bayer', '5mg', 'tablet', 'S10', 'rx'],
  ['Microgynon 30', 'Ethinylestradiol + Levonorgestrel', 'Bayer', '30mcg + 150mcg', 'tablet', 'S21', 'rx'],
  ['Levonorgestrel', 'Levonorgestrel', 'Generic', '1.5mg', 'tablet', 'S1', 'rx'],

  // Eye and ear
  ['Refresh Tears', 'Carboxymethylcellulose', 'Allergan', '0.5%', 'drops', 'B1', 'otc'],
  ['Ciloxan Eye Drops', 'Ciprofloxacin', 'Alcon', '0.3%', 'drops', 'B1', 'rx'],
  ['Tobrex Eye Drops', 'Tobramycin', 'Alcon', '0.3%', 'drops', 'B1', 'rx'],

  // Oral and misc
  ['Oxytocin Injection', 'Oxytocin', 'Generic', '10 IU/ml', 'injection', 'A1', 'rx'],
  ['Lidocaine Injection', 'Lidocaine', 'Generic', '2%', 'injection', 'V1', 'rx'],
  ['Normal Saline', 'Sodium chloride', 'Generic', '0.9%', 'injection', 'B1', 'general'],
  ['Dextrose Drip', 'Dextrose', 'Generic', '5%', 'injection', 'B1', 'general'],
  ['Surgical Gloves', 'Not applicable', 'Generic', 'Medium', 'other', 'P1', 'general'],
  ['Cotton Roll', 'Not applicable', 'Generic', '100g', 'other', 'P1', 'general'],
  ['Bandage Roll', 'Not applicable', 'Generic', '3 inch', 'other', 'P1', 'general'],
  ['Glucometer Strips', 'Not applicable', 'Generic', 'Pack of 50', 'other', 'P1', 'general'],
  ['Syringe 5ml', 'Not applicable', 'Generic', '5ml', 'other', 'P1', 'general'],
  ['Face Mask', 'Not applicable', 'Generic', '3-ply', 'other', 'P1', 'general'],
];

const FORM_UNIT = { tablet: 'tablet', capsule: 'capsule', sachet: 'sachet', powder: 'sachet', cream: 'tube', gel: 'tube', ointment: 'tube', inhaler: 'puff', spray: 'bottle', syrup: 'bottle', suspension: 'bottle', drops: 'bottle', injection: 'vial', other: 'piece' };
const PACK_SOLD_AS = { S: 'strip', B: 'bottle', T: 'tube', V: 'vial', A: 'ampoule', I: 'pack', X: 'box', P: 'piece' };

/** Insulin and the injectables that need cold storage. */
export function storageFor(row) {
  return /insulin/i.test(row[0]) || /Mixtard|Actrapid|Lantus/i.test(row[0]) ? 'fridge' : 'room';
}

/** Turns one seed row into a product input for products.createProduct / importProducts. */
export function seedToProduct([name, generic, company, strength, form, pack, cls]) {
  const letter = pack[0];
  const units = Number(pack.slice(1)) || 1;
  const isBulk = letter === 'B' || letter === 'V' || letter === 'A' || letter === 'T' || letter === 'I';
  return {
    name,
    generic: generic === 'Not applicable' ? '' : generic,
    company: company === 'Generic' ? '' : company,
    strength,
    form,
    class: cls,
    storage: storageFor([name]),
    soldAs: PACK_SOLD_AS[letter] ?? 'pack',
    // A bottle, vial or inhaler is one unit of its own. A strip holds several tablets.
    unitsPerPack: isBulk ? 1 : units,
    unitName: isBulk ? 'pack' : FORM_UNIT[form] ?? 'unit',
    // Loose selling needs a price, which the seed does not have. The pharmacy turns it on with its own price.
    looseSelling: false,
    mrpPerPack: 0,
    salePricePerPack: 0,
    costPerPack: 0,
  };
}

export const popularMedicines = () => POPULAR_MEDICINES.map(seedToProduct);

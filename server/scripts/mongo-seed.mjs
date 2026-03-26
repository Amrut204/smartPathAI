// MongoDB seed script for CampusDrive AI development environment
// Usage: node --env-file=.env server/scripts/mongo-seed.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "campusdrive_dev";
const DEFAULT_PASSWORD = "Password@123";
const BASE_SEED = Number(process.env.SEED_VALUE ?? 20260303);

const TOPIC_DEFS = [
  { key: "aptitude", name: "Aptitude & Reasoning" },
  { key: "dsa", name: "Data Structures & Algorithms" },
  { key: "sql", name: "SQL & Databases" },
  { key: "os", name: "Operating Systems" },
  { key: "cn", name: "Computer Networks" },
  { key: "oops", name: "OOPs" },
  { key: "dbms", name: "DBMS" },
  { key: "system_design", name: "System Design" },
  { key: "python", name: "Python Programming" },
  { key: "java", name: "Java Programming" },
  { key: "javascript", name: "JavaScript" },
  { key: "ai_ml", name: "AI & Machine Learning" },
  { key: "analog_electronics", name: "Analog Electronics" },
  { key: "digital_electronics", name: "Digital Electronics" },
  { key: "communication_systems", name: "Communication Systems" },
  { key: "signals_systems", name: "Signals & Systems" },
  { key: "embedded_systems", name: "Microcontrollers & Embedded Systems" },
  { key: "circuit_theory", name: "Circuit Theory" },
  { key: "electrical_machines", name: "Electrical Machines" },
  { key: "power_systems", name: "Power Systems" },
  { key: "control_systems", name: "Control Systems" },
  { key: "power_electronics", name: "Power Electronics" },
  { key: "thermodynamics", name: "Thermodynamics" },
  { key: "som", name: "Strength of Materials" },
  { key: "manufacturing", name: "Manufacturing Processes" },
  { key: "fluid_mechanics", name: "Fluid Mechanics" },
  { key: "cad_cam", name: "CAD/CAM" },
  { key: "structural_analysis", name: "Structural Analysis" },
  { key: "surveying", name: "Surveying" },
  { key: "geotechnical", name: "Geotechnical Engineering" },
  { key: "transportation", name: "Transportation Engineering" },
  { key: "construction_management", name: "Construction Management" },
];

const TEST_TOPIC_KEYS = TOPIC_DEFS.map((topic) => topic.key);
const DIFFICULTIES = ["easy", "medium", "hard"];

const COLLEGES = [
  {
    name: "Apex Engineering College",
    slug: "apex",
    domain: "apex.edu",
    studentCount: 80,
    rollPrefix: "APX",
    brandColor: "#15616d",
    tpoName: "Dr. Placement Officer",
    tpoEmail: "tpo@apex.edu",
  },
  {
    name: "Nova Institute of Technology",
    slug: "nova",
    domain: "nova.edu",
    studentCount: 94,
    rollPrefix: "NIT",
    brandColor: "#1f6f8b",
    tpoName: "Ms. Priya Menon",
    tpoEmail: "tpo@nova.edu",
  },
];

const PLATFORM_ADMIN = {
  email: "admin@smartpath.local",
  fullName: "Platform Admin",
};

const BRANCH_WEIGHTS = [
  { value: "CSE", weight: 34 },
  { value: "IT", weight: 18 },
  { value: "ECE", weight: 18 },
  { value: "EEE", weight: 10 },
  { value: "ME", weight: 10 },
  { value: "Civil", weight: 10 },
];

const BATCH_WEIGHTS = [
  { value: "2025", weight: 20 },
  { value: "2026", weight: 58 },
  { value: "2027", weight: 22 },
];

const BRANCH_TOPIC_WEIGHTS = {
  CSE: [
    { value: "dsa", weight: 18 },
    { value: "sql", weight: 14 },
    { value: "os", weight: 12 },
    { value: "cn", weight: 10 },
    { value: "dbms", weight: 12 },
    { value: "system_design", weight: 8 },
    { value: "oops", weight: 8 },
    { value: "python", weight: 7 },
    { value: "java", weight: 7 },
    { value: "aptitude", weight: 14 },
  ],
  IT: [
    { value: "dsa", weight: 14 },
    { value: "sql", weight: 14 },
    { value: "dbms", weight: 12 },
    { value: "cn", weight: 10 },
    { value: "oops", weight: 10 },
    { value: "javascript", weight: 8 },
    { value: "python", weight: 8 },
    { value: "java", weight: 8 },
    { value: "aptitude", weight: 16 },
  ],
  ECE: [
    { value: "digital_electronics", weight: 18 },
    { value: "analog_electronics", weight: 16 },
    { value: "communication_systems", weight: 14 },
    { value: "signals_systems", weight: 12 },
    { value: "embedded_systems", weight: 12 },
    { value: "aptitude", weight: 16 },
    { value: "python", weight: 6 },
    { value: "dsa", weight: 6 },
  ],
  EEE: [
    { value: "circuit_theory", weight: 18 },
    { value: "electrical_machines", weight: 18 },
    { value: "power_systems", weight: 16 },
    { value: "control_systems", weight: 14 },
    { value: "power_electronics", weight: 12 },
    { value: "aptitude", weight: 16 },
    { value: "python", weight: 6 },
  ],
  ME: [
    { value: "thermodynamics", weight: 18 },
    { value: "som", weight: 16 },
    { value: "manufacturing", weight: 16 },
    { value: "fluid_mechanics", weight: 14 },
    { value: "cad_cam", weight: 12 },
    { value: "aptitude", weight: 18 },
    { value: "python", weight: 6 },
  ],
  Civil: [
    { value: "structural_analysis", weight: 18 },
    { value: "surveying", weight: 16 },
    { value: "geotechnical", weight: 14 },
    { value: "transportation", weight: 14 },
    { value: "construction_management", weight: 12 },
    { value: "aptitude", weight: 20 },
    { value: "python", weight: 6 },
  ],
};

const BRANCH_SKILLS = {
  CSE: ["Java", "Python", "SQL", "DSA", "OOPs", "DBMS", "OS", "Computer Networks", "System Design"],
  IT: ["JavaScript", "React", "Node.js", "SQL", "Python", "Cloud Basics", "OOPs", "DBMS"],
  ECE: ["C", "Python", "Embedded Systems", "Digital Electronics", "Analog Electronics", "Communication Systems", "Signals & Systems"],
  EEE: ["C", "Python", "Control Systems", "Power Systems", "Electrical Machines", "Circuit Theory", "Power Electronics"],
  ME: ["AutoCAD", "Manufacturing", "Thermodynamics", "Fluid Mechanics", "Strength of Materials", "CAD/CAM", "Python"],
  Civil: ["AutoCAD", "Surveying", "Structural Analysis", "Geotechnical Engineering", "Construction Management", "Transportation Engineering", "Python"],
};

const COMMON_SKILLS = ["Communication", "Teamwork", "Problem Solving", "Critical Thinking", "Time Management"];

const CITY_POOL = [
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Chennai",
  "Mumbai",
  "Delhi",
  "Ahmedabad",
  "Kolkata",
  "Coimbatore",
  "Lucknow",
];

const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Arjun", "Ishaan", "Kabir", "Rohan", "Vihaan", "Aryan", "Krishna",
  "Aditi", "Ananya", "Priya", "Sneha", "Ishita", "Riya", "Meera", "Kavya", "Pooja", "Nisha",
  "Rahul", "Karan", "Siddharth", "Nikhil", "Varun", "Harsh", "Akshay", "Manish", "Abhishek", "Yash",
  "Neha", "Sanya", "Tanvi", "Diya", "Simran", "Trisha", "Manya", "Nandini", "Bhavana", "Sakshi",
  "Dev", "Ritvik", "Aniket", "Pranav", "Soham", "Aman", "Shubham", "Tanish", "Omkar", "Adarsh",
  "Shruti", "Rashmi", "Palak", "Apoorva", "Kirti", "Swati", "Mahima", "Ankita", "Ira", "Lavanya",
];

const LAST_NAMES = [
  "Sharma", "Verma", "Patel", "Reddy", "Nair", "Iyer", "Gupta", "Mehta", "Kulkarni", "Mishra",
  "Singh", "Jain", "Rao", "Joshi", "Yadav", "Agarwal", "Bhat", "Kapoor", "Saxena", "Malhotra",
  "Desai", "Pillai", "Menon", "Ghosh", "Chatterjee", "Dutta", "Das", "Roy", "Sinha", "Kumar",
  "Chaudhary", "Pandey", "Tripathi", "Thakur", "Dubey", "Khandelwal", "Nigam", "Tiwari", "Bansal", "Bose",
];

const QUESTION_BANK = {
  aptitude: [
    {
      text: "A number is increased by 20% and then decreased by 20%. What is the net change?",
      options: ["No change", "4% decrease", "4% increase", "2% decrease"],
      correctIndex: 1,
      explanation: "A 20% increase then 20% decrease results in 0.8 x 1.2 = 0.96, i.e. 4% decrease.",
    },
    {
      text: "If 12 workers complete a task in 10 days, how many days will 15 workers take?",
      options: ["6", "8", "10", "12"],
      correctIndex: 1,
      explanation: "Total work is constant. 12 x 10 = 120 worker-days; 120/15 = 8 days.",
    },
    {
      text: "A train covers 360 km in 6 hours. What is its speed?",
      options: ["50 km/h", "55 km/h", "60 km/h", "65 km/h"],
      correctIndex: 2,
      explanation: "Speed = distance / time = 360/6 = 60 km/h.",
    },
  ],
  dsa: [
    {
      text: "What is the average-case time complexity of binary search?",
      options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
      correctIndex: 1,
      explanation: "Binary search halves the search space each iteration.",
    },
    {
      text: "Which data structure follows LIFO order?",
      options: ["Queue", "Heap", "Stack", "Linked List"],
      correctIndex: 2,
      explanation: "Stack supports Last-In First-Out operations.",
    },
    {
      text: "Which traversal visits nodes in left-root-right order?",
      options: ["Preorder", "Inorder", "Postorder", "Level order"],
      correctIndex: 1,
      explanation: "Inorder traversal is left-root-right.",
    },
  ],
  sql: [
    {
      text: "Which SQL clause is used to filter groups after aggregation?",
      options: ["WHERE", "GROUP BY", "HAVING", "ORDER BY"],
      correctIndex: 2,
      explanation: "HAVING is applied after GROUP BY aggregation.",
    },
    {
      text: "Which join returns all matching rows plus non-matching rows from the left table?",
      options: ["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "CROSS JOIN"],
      correctIndex: 1,
      explanation: "LEFT JOIN keeps all rows from the left table.",
    },
    {
      text: "Which statement removes a table structure and data?",
      options: ["DELETE", "TRUNCATE", "DROP TABLE", "REMOVE TABLE"],
      correctIndex: 2,
      explanation: "DROP TABLE removes both schema and data.",
    },
  ],
  os: [
    {
      text: "Which scheduling algorithm can cause starvation?",
      options: ["Round Robin", "FCFS", "Shortest Job First", "Multilevel Queue"],
      correctIndex: 2,
      explanation: "SJF may starve long jobs if short jobs keep arriving.",
    },
    {
      text: "A page fault occurs when:",
      options: ["Page is in TLB", "Page is in cache", "Page is not in main memory", "Disk is full"],
      correctIndex: 2,
      explanation: "Page fault occurs when referenced page is absent in RAM.",
    },
    {
      text: "Deadlock requires which necessary condition?",
      options: ["Preemption", "Mutual exclusion", "Aging", "Thrashing"],
      correctIndex: 1,
      explanation: "Mutual exclusion is one of Coffman conditions.",
    },
  ],
  cn: [
    {
      text: "Which layer in OSI handles routing?",
      options: ["Transport", "Data Link", "Network", "Session"],
      correctIndex: 2,
      explanation: "Routing is a network-layer responsibility.",
    },
    {
      text: "What is the default port for HTTPS?",
      options: ["21", "80", "443", "587"],
      correctIndex: 2,
      explanation: "HTTPS commonly uses TCP port 443.",
    },
    {
      text: "Which protocol maps domain names to IP addresses?",
      options: ["HTTP", "DNS", "ARP", "ICMP"],
      correctIndex: 1,
      explanation: "DNS resolves names to IP addresses.",
    },
  ],
  analog_electronics: [
    {
      text: "Which transistor region is commonly used for amplification?",
      options: ["Cutoff", "Active", "Saturation", "Breakdown"],
      correctIndex: 1,
      explanation: "In the active region, transistor output is proportional to the input signal.",
    },
    {
      text: "An ideal op-amp has:",
      options: ["Low gain", "Infinite input impedance", "High output impedance", "Zero bandwidth"],
      correctIndex: 1,
      explanation: "Ideal op-amps are assumed to have infinite input impedance.",
    },
    {
      text: "A diode conducts significantly in forward bias after crossing its threshold voltage.",
      options: ["True", "False", "Only in reverse bias", "Only in AC circuits"],
      correctIndex: 0,
      explanation: "Forward bias lowers the depletion barrier and enables conduction.",
    },
  ],
  digital_electronics: [
    {
      text: "Which logic gate outputs 1 only when both inputs are 1?",
      options: ["OR", "AND", "XOR", "NOR"],
      correctIndex: 1,
      explanation: "AND produces HIGH only when all inputs are HIGH.",
    },
    {
      text: "A flip-flop is primarily used to:",
      options: ["Amplify signals", "Store one bit", "Perform analog filtering", "Generate AC supply"],
      correctIndex: 1,
      explanation: "Flip-flops are the basic storage element in digital systems.",
    },
    {
      text: "Which numbering system uses base 2?",
      options: ["Decimal", "Hexadecimal", "Binary", "Octal"],
      correctIndex: 2,
      explanation: "Binary uses only 0 and 1 and is base 2.",
    },
  ],
  communication_systems: [
    {
      text: "Which modulation varies the amplitude of the carrier?",
      options: ["FM", "PM", "AM", "PCM"],
      correctIndex: 2,
      explanation: "AM stands for amplitude modulation.",
    },
    {
      text: "Noise margin indicates:",
      options: ["Signal strength loss", "Tolerance against unwanted disturbances", "Bandwidth", "Phase shift"],
      correctIndex: 1,
      explanation: "Noise margin quantifies immunity to noise.",
    },
    {
      text: "Antenna gain is generally measured in:",
      options: ["Volts", "dB", "Watts", "Henries"],
      correctIndex: 1,
      explanation: "Antenna gain is commonly expressed in decibels.",
    },
  ],
  signals_systems: [
    {
      text: "A linear time-invariant system is characterized by:",
      options: ["Only linearity", "Only time variance", "Linearity and time invariance", "Memorylessness only"],
      correctIndex: 2,
      explanation: "LTI systems satisfy both linearity and time-invariance properties.",
    },
    {
      text: "Which transform is widely used to analyze signals in the frequency domain?",
      options: ["Laplace", "Fourier", "Z-transform", "All of these"],
      correctIndex: 3,
      explanation: "All three transforms are used depending on the signal/system type.",
    },
    {
      text: "Convolution is used to determine:",
      options: ["Average power only", "System output from input and impulse response", "Circuit current only", "Signal bandwidth only"],
      correctIndex: 1,
      explanation: "Convolution combines input and impulse response to get output.",
    },
  ],
  embedded_systems: [
    {
      text: "A microcontroller typically integrates:",
      options: ["Only CPU", "CPU, memory, and peripherals", "Only memory", "Only I/O ports"],
      correctIndex: 1,
      explanation: "Microcontrollers combine processing, memory, and peripherals on one chip.",
    },
    {
      text: "UART is primarily used for:",
      options: ["Parallel communication", "Serial communication", "Power control", "Clock generation"],
      correctIndex: 1,
      explanation: "UART is a serial communication protocol.",
    },
    {
      text: "An interrupt helps a controller:",
      options: ["Ignore external events", "Respond immediately to an event", "Reduce memory size", "Increase clock speed"],
      correctIndex: 1,
      explanation: "Interrupts let the CPU react quickly to important events.",
    },
  ],
  circuit_theory: [
    {
      text: "Ohm's law is:",
      options: ["V = IR", "P = VI", "Q = CV", "E = mc^2"],
      correctIndex: 0,
      explanation: "Voltage equals current multiplied by resistance.",
    },
    {
      text: "Kirchhoff's current law is based on conservation of:",
      options: ["Energy", "Charge", "Mass", "Momentum"],
      correctIndex: 1,
      explanation: "KCL follows from conservation of charge.",
    },
    {
      text: "The unit of capacitance is:",
      options: ["Henry", "Farad", "Ohm", "Tesla"],
      correctIndex: 1,
      explanation: "Capacitance is measured in farads.",
    },
  ],
  electrical_machines: [
    {
      text: "A transformer operates on the principle of:",
      options: ["Electrolysis", "Mutual induction", "Photoelectric effect", "Piezoelectric effect"],
      correctIndex: 1,
      explanation: "Transformers transfer power through mutual induction.",
    },
    {
      text: "Slip is associated with:",
      options: ["DC motor", "Induction motor", "Transformer", "Alternator only"],
      correctIndex: 1,
      explanation: "Slip is a key concept in induction motors.",
    },
    {
      text: "Which machine converts mechanical energy to electrical energy?",
      options: ["Motor", "Generator", "Transformer", "Rectifier"],
      correctIndex: 1,
      explanation: "Generators convert mechanical input to electrical output.",
    },
  ],
  power_systems: [
    {
      text: "A transmission line is mainly used to:",
      options: ["Generate power", "Transmit power over distance", "Store power", "Measure power"],
      correctIndex: 1,
      explanation: "Transmission systems move electrical power from source to load centers.",
    },
    {
      text: "Load flow studies are used to determine:",
      options: ["Machine temperature", "Voltage and power flow in the system", "Transformer oil level", "Relay color"],
      correctIndex: 1,
      explanation: "Load flow gives voltages, currents, and power values across the network.",
    },
    {
      text: "Protective relays are installed to:",
      options: ["Increase generation", "Detect faults and isolate sections", "Reduce tariffs", "Store energy"],
      correctIndex: 1,
      explanation: "Relays help identify and isolate faulty system sections.",
    },
  ],
  control_systems: [
    {
      text: "Feedback in a control system is used to:",
      options: ["Increase uncertainty", "Improve system response and accuracy", "Remove sensors", "Lower supply voltage"],
      correctIndex: 1,
      explanation: "Feedback improves accuracy and dynamic behavior.",
    },
    {
      text: "A stable system produces:",
      options: ["Unbounded output for bounded input", "Bounded output for bounded input", "Infinite gain", "Zero response always"],
      correctIndex: 1,
      explanation: "BIBO stability means bounded input gives bounded output.",
    },
    {
      text: "The Laplace transform is commonly used in control engineering to analyze:",
      options: ["Time-only responses", "System transfer functions", "Mechanical drawings", "Power factor only"],
      correctIndex: 1,
      explanation: "Transfer functions are commonly represented in the Laplace domain.",
    },
  ],
  power_electronics: [
    {
      text: "A rectifier converts:",
      options: ["AC to DC", "DC to AC", "DC to DC", "AC to AC only"],
      correctIndex: 0,
      explanation: "Rectifiers convert alternating current to direct current.",
    },
    {
      text: "An inverter converts:",
      options: ["AC to DC", "DC to AC", "AC to AC", "Frequency to voltage"],
      correctIndex: 1,
      explanation: "Inverters convert DC input into AC output.",
    },
    {
      text: "A thyristor is mainly used as a:",
      options: ["Sensor", "Controlled switch", "Transformer core", "Battery"],
      correctIndex: 1,
      explanation: "Thyristors are power semiconductor switching devices.",
    },
  ],
  thermodynamics: [
    {
      text: "The first law of thermodynamics is based on conservation of:",
      options: ["Charge", "Momentum", "Energy", "Entropy"],
      correctIndex: 2,
      explanation: "The first law states that energy is conserved.",
    },
    {
      text: "Entropy is commonly associated with:",
      options: ["System order/disorder", "Voltage", "Force", "Density only"],
      correctIndex: 0,
      explanation: "Entropy measures energy dispersal and disorder.",
    },
    {
      text: "A system boundary separates:",
      options: ["Two circuits", "System and surroundings", "Only solid objects", "Only gases"],
      correctIndex: 1,
      explanation: "The boundary defines the system from its surroundings.",
    },
  ],
  som: [
    {
      text: "Stress is defined as:",
      options: ["Force", "Force per unit area", "Area per unit force", "Mass per unit area"],
      correctIndex: 1,
      explanation: "Stress equals force divided by cross-sectional area.",
    },
    {
      text: "Strain is a measure of:",
      options: ["Load", "Deformation per unit length", "Velocity", "Temperature"],
      correctIndex: 1,
      explanation: "Strain measures relative deformation.",
    },
    {
      text: "Young's modulus relates:",
      options: ["Stress and strain", "Pressure and volume", "Heat and work", "Torque and speed"],
      correctIndex: 0,
      explanation: "Young's modulus is the ratio of stress to strain in the elastic region.",
    },
  ],
  manufacturing: [
    {
      text: "Casting is a process where material is:",
      options: ["Cut away", "Poured into a mold", "Joined by solder", "Rolled into sheets only"],
      correctIndex: 1,
      explanation: "Casting forms parts by pouring molten material into a mold.",
    },
    {
      text: "Welding is mainly a:",
      options: ["Machining process", "Joining process", "Measuring process", "Heat treatment only"],
      correctIndex: 1,
      explanation: "Welding permanently joins materials.",
    },
    {
      text: "A lathe is commonly used for:",
      options: ["Milling", "Turning operations", "Forging", "Inspection only"],
      correctIndex: 1,
      explanation: "Lathes perform turning where the workpiece rotates.",
    },
  ],
  fluid_mechanics: [
    {
      text: "Bernoulli's equation relates pressure, velocity, and:",
      options: ["Temperature", "Elevation", "Resistance", "Conductivity"],
      correctIndex: 1,
      explanation: "Bernoulli relates pressure, kinetic, and potential energy terms.",
    },
    {
      text: "Viscosity represents a fluid's:",
      options: ["Density", "Resistance to flow", "Temperature", "Compressibility only"],
      correctIndex: 1,
      explanation: "Viscosity is internal resistance to deformation/flow.",
    },
    {
      text: "Flow with smooth particle paths is called:",
      options: ["Turbulent", "Laminar", "Transient", "Critical"],
      correctIndex: 1,
      explanation: "Laminar flow has smooth parallel layers.",
    },
  ],
  cad_cam: [
    {
      text: "CAD stands for:",
      options: ["Computer Aided Design", "Computer Assisted Drafting only", "Controlled Automated Design", "Computer Analog Drawing"],
      correctIndex: 0,
      explanation: "CAD means Computer Aided Design.",
    },
    {
      text: "CAM is mainly used for:",
      options: ["Marketing", "Manufacturing support and automation", "Accounting", "Only analysis"],
      correctIndex: 1,
      explanation: "CAM supports manufacturing using computer-controlled processes.",
    },
    {
      text: "2D and 3D modeling are common functions of:",
      options: ["PLC", "CAD software", "Generators", "Survey equipment"],
      correctIndex: 1,
      explanation: "CAD tools are used for drafting and modeling.",
    },
  ],
  structural_analysis: [
    {
      text: "A simply supported beam has:",
      options: ["No supports", "Two supports allowing rotation", "Fixed ends both sides", "Only one support"],
      correctIndex: 1,
      explanation: "A simply supported beam has pin/roller style supports.",
    },
    {
      text: "Bending moment is caused by:",
      options: ["Axial load only", "Loads acting at a distance", "Temperature only", "Color change"],
      correctIndex: 1,
      explanation: "Moments arise when forces act with a lever arm.",
    },
    {
      text: "Deflection refers to:",
      options: ["Stress value", "Displacement of a structural member", "Density change", "Material cost"],
      correctIndex: 1,
      explanation: "Deflection is the displacement under loading.",
    },
  ],
  surveying: [
    {
      text: "Surveying is primarily used to:",
      options: ["Measure land positions and features", "Generate electricity", "Mix concrete", "Test soil chemistry only"],
      correctIndex: 0,
      explanation: "Surveying determines relative positions of points on the earth.",
    },
    {
      text: "A theodolite is commonly used to measure:",
      options: ["Temperature", "Angles", "Soil strength", "Concrete mix ratio"],
      correctIndex: 1,
      explanation: "Theodolites are angle-measuring instruments.",
    },
    {
      text: "Levelling helps determine:",
      options: ["Difference in elevation", "Traffic volume", "Power factor", "Fuel consumption"],
      correctIndex: 0,
      explanation: "Levelling is used to determine relative heights.",
    },
  ],
  geotechnical: [
    {
      text: "Soil bearing capacity is important for:",
      options: ["Paint selection", "Foundation design", "Electrical wiring", "Steel grading only"],
      correctIndex: 1,
      explanation: "Foundation sizing depends on safe bearing capacity.",
    },
    {
      text: "Compaction of soil is done to:",
      options: ["Increase voids", "Improve strength and reduce settlement", "Reduce density", "Increase water content only"],
      correctIndex: 1,
      explanation: "Compaction improves engineering properties of soil.",
    },
    {
      text: "A retaining wall is used to:",
      options: ["Carry electric current", "Hold back soil", "Store water only", "Measure load"],
      correctIndex: 1,
      explanation: "Retaining walls resist lateral soil pressure.",
    },
  ],
  transportation: [
    {
      text: "Pavement design is a topic under:",
      options: ["Transportation engineering", "Thermodynamics", "Power systems", "Digital electronics"],
      correctIndex: 0,
      explanation: "Road and pavement design belong to transportation engineering.",
    },
    {
      text: "Traffic volume studies help in:",
      options: ["Site excavation only", "Road planning and capacity decisions", "Power distribution", "Machine winding"],
      correctIndex: 1,
      explanation: "Traffic studies support transport planning and design.",
    },
    {
      text: "The geometric design of highways deals with:",
      options: ["Road alignment and layout", "Soil chemistry only", "Transformer sizing", "Binary logic"],
      correctIndex: 0,
      explanation: "It covers layout, curves, gradients, and road geometry.",
    },
  ],
  construction_management: [
    {
      text: "CPM in project management stands for:",
      options: ["Critical Path Method", "Concrete Production Model", "Control Process Mapping", "Construction Planning Metric"],
      correctIndex: 0,
      explanation: "CPM is the Critical Path Method.",
    },
    {
      text: "A project schedule is used to manage:",
      options: ["Only budget", "Time and activity sequence", "Only soil type", "Only material color"],
      correctIndex: 1,
      explanation: "Scheduling organizes project activities over time.",
    },
    {
      text: "Site safety management is primarily concerned with:",
      options: ["Decorative finish", "Preventing accidents and ensuring compliance", "Only procurement", "Only surveying"],
      correctIndex: 1,
      explanation: "Safety management minimizes hazards and regulatory risk.",
    },
  ],
  default: [
    {
      text: "Choose the best answer based on standard placement preparation concepts.",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: 1,
      explanation: "Refer to the concept notes for the reasoning.",
    },
  ],
};

function hashString(value) {
  let hashValue = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return hashValue >>> 0;
}

function createRng(seedValue) {
  let state = hashString(String(seedValue)) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomFloat(rng, min, max, decimals = 2) {
  const value = min + rng() * (max - min);
  return Number(value.toFixed(decimals));
}

function chance(rng, probability) {
  return rng() < probability;
}

function pick(rng, list) {
  return list[randomInt(rng, 0, list.length - 1)];
}

function weightedPick(rng, weightedItems) {
  const total = weightedItems.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng() * total;
  for (const item of weightedItems) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.value;
    }
  }
  return weightedItems[weightedItems.length - 1].value;
}

function randomNormal(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toIsoDateOffset(daysOffset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return date.toISOString().slice(0, 10);
}

function randomPastDateTime(rng, maxDaysAgo, minDaysAgo = 0) {
  const daysAgo = randomInt(rng, minDaysAgo, maxDaysAgo);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(randomInt(rng, 7, 22), randomInt(rng, 0, 59), randomInt(rng, 0, 59), 0);
  return date.toISOString();
}

function randomStudyDate(rng, maxDaysAgo = 95) {
  const bias = Math.pow(rng(), 1.8);
  const daysAgo = Math.floor(bias * maxDaysAgo);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function pickSkills(rng, branch) {
  const pool = [...(BRANCH_SKILLS[branch] ?? []), ...COMMON_SKILLS];
  const selected = new Set();
  while (selected.size < 5 && selected.size < pool.length) {
    selected.add(pick(rng, pool));
  }
  return [...selected];
}

function estimateReadiness({ avgTestScore, avgMastery, totalStudyHours, points }) {
  const studyScore = Math.min(100, (totalStudyHours / 40) * 100);
  const pointsScore = Math.min(100, (points / 1000) * 100);
  const readiness = avgTestScore * 0.4 + avgMastery * 0.25 + studyScore * 0.2 + pointsScore * 0.15;
  return Number(readiness.toFixed(2));
}

function toDayNumber(isoDate) {
  return Math.floor(Date.parse(`${isoDate}T00:00:00.000Z`) / 86_400_000);
}

function computeStreakMetrics(studyDates) {
  if (studyDates.size === 0) {
    return { current: 0, longest: 0 };
  }

  const dayNumbers = [...studyDates].map(toDayNumber).sort((a, b) => a - b);
  const daySet = new Set(dayNumbers);

  let longest = 1;
  let run = 1;
  for (let index = 1; index < dayNumbers.length; index += 1) {
    if (dayNumbers[index] === dayNumbers[index - 1] + 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else if (dayNumbers[index] !== dayNumbers[index - 1]) {
      run = 1;
    }
  }

  const todayDay = toDayNumber(new Date().toISOString().slice(0, 10));
  let current = 0;
  let cursor = todayDay;
  while (daySet.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  return { current, longest };
}

function rotateOptions(options, shift) {
  if (shift <= 0 || shift >= options.length) return [...options];
  return [...options.slice(-shift), ...options.slice(0, options.length - shift)];
}

function buildQuestionsForTest(topicKey, topicName, difficulty, questionCount, rng) {
  const bank = QUESTION_BANK[topicKey] ?? QUESTION_BANK.default;
  const questions = [];
  for (let index = 0; index < questionCount; index += 1) {
    const template = bank[index % bank.length];
    const shift = randomInt(rng, 0, template.options.length - 1);
    const options = rotateOptions(template.options, shift);
    const correctIndex = (template.correctIndex + shift) % template.options.length;
    questions.push({
      text: `${template.text} [${topicName} | ${difficulty.toUpperCase()} | Q${index + 1}]`,
      options,
      correctIndex,
      explanation: template.explanation,
    });
  }
  return questions;
}

function randomDifferentOption(rng, optionsLength, correctIndex) {
  if (optionsLength <= 1) return correctIndex;
  let value = randomInt(rng, 0, optionsLength - 1);
  while (value === correctIndex) {
    value = randomInt(rng, 0, optionsLength - 1);
  }
  return value;
}

function sampleIndices(rng, count, maxExclusive) {
  const source = [...Array(maxExclusive).keys()];
  for (let index = source.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(rng, 0, index);
    const tmp = source[index];
    source[index] = source[swapIndex];
    source[swapIndex] = tmp;
  }
  return source.slice(0, count).sort((a, b) => a - b);
}

function inferTopicKeyFromPath(relativePath) {
  const value = relativePath.toLowerCase();
  const checks = [
    ["aptitude", "aptitude"],
    ["quant", "aptitude"],
    ["reasoning", "aptitude"],
    ["dsa", "dsa"],
    ["algorithm", "dsa"],
    ["data-structure", "dsa"],
    ["sql", "sql"],
    ["database", "dbms"],
    ["dbms", "dbms"],
    ["operating system", "os"],
    ["os/", "os"],
    ["network", "cn"],
    ["oop", "oops"],
    ["system design", "system_design"],
    ["java", "java"],
    ["python", "python"],
    ["javascript", "javascript"],
    ["ml", "ai_ml"],
    ["ai", "ai_ml"],
    ["analog", "analog_electronics"],
    ["digital", "digital_electronics"],
    ["communication system", "communication_systems"],
    ["signals", "signals_systems"],
    ["embedded", "embedded_systems"],
    ["circuit theory", "circuit_theory"],
    ["electrical machine", "electrical_machines"],
    ["power system", "power_systems"],
    ["control system", "control_systems"],
    ["power electronics", "power_electronics"],
    ["thermodynamics", "thermodynamics"],
    ["strength of materials", "som"],
    ["manufacturing", "manufacturing"],
    ["fluid mechanics", "fluid_mechanics"],
    ["cad", "cad_cam"],
    ["structural", "structural_analysis"],
    ["survey", "surveying"],
    ["geotechnical", "geotechnical"],
    ["transportation", "transportation"],
    ["construction management", "construction_management"],
  ];

  for (const [token, topicKey] of checks) {
    if (value.includes(token)) {
      return topicKey;
    }
  }
  return null;
}

function titleFromPdfPath(relativePath) {
  const base = path.basename(relativePath, path.extname(relativePath));
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveMaterialRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(scriptDir, "../../material"),
    path.resolve(process.cwd(), "../material"),
    path.resolve(process.cwd(), "material"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? null;
}

function collectPdfFiles(rootDir, maxFiles = 500) {
  if (!rootDir || !fs.existsSync(rootDir)) return [];
  const result = [];
  const stack = [rootDir];

  while (stack.length > 0 && result.length < maxFiles) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        result.push(path.relative(rootDir, absolutePath).replace(/\\/g, "/"));
        if (result.length >= maxFiles) break;
      }
    }
  }

  return result.sort((a, b) => a.localeCompare(b));
}

async function insertManyChunked(db, collectionName, documents, chunkSize = 1000) {
  if (documents.length === 0) return;
  for (let offset = 0; offset < documents.length; offset += chunkSize) {
    const chunk = documents.slice(offset, offset + chunkSize);
    await db.collection(collectionName).insertMany(chunk, { ordered: false });
  }
}

function buildCompanyNames(collegeSlug) {
  const prefix = collegeSlug === "apex" ? "Apex" : "Nova";
  return [
    `${prefix}Tech Systems`,
    "TechCorp India",
    "DataSoft Solutions",
    "CloudNexus Labs",
    "ByteWave Technologies",
    "Orbit Analytics",
    "Infotrek Global",
    "CodeGrid Innovations",
    "Quantum Bridge AI",
    "Vertex Mobility",
  ];
}

function generateDriveConfigs(rng) {
  return [
    { status: "upcoming", dayOffset: 10, role: "SDE Intern" },
    { status: "upcoming", dayOffset: 24, role: "Data Analyst Intern" },
    { status: "active", dayOffset: -3, role: "Associate Software Engineer" },
    { status: "active", dayOffset: 5, role: "Graduate Trainee" },
    { status: "completed", dayOffset: -30, role: "Software Engineer" },
    { status: "completed", dayOffset: -48, role: "Analyst" },
    { status: "completed", dayOffset: -75, role: "DevOps Engineer" },
    { status: "cancelled", dayOffset: 18, role: "Support Engineer" },
  ].map((item) => ({
    ...item,
    minCgpa: Number(randomFloat(rng, 6.0, 8.2, 1).toFixed(1)),
    maxBacklogs: chance(rng, 0.6) ? 0 : 1,
    minAttendance: randomInt(rng, 68, 84),
  }));
}

function branchBias(branch) {
  if (branch === "CSE") return 0.35;
  if (branch === "IT") return 0.22;
  if (branch === "ECE") return 0.15;
  if (branch === "EEE") return 0.05;
  if (branch === "ME") return -0.05;
  return -0.1;
}

function selectMaterialSlice(pdfPaths, count, offset) {
  if (pdfPaths.length === 0) return [];
  const selected = [];
  const seen = new Set();
  const step = Math.max(1, Math.floor(pdfPaths.length / Math.max(count, 1)));
  let cursor = offset % pdfPaths.length;

  while (selected.length < count && seen.size < pdfPaths.length) {
    const relativePath = pdfPaths[cursor];
    if (!seen.has(relativePath)) {
      seen.add(relativePath);
      selected.push(relativePath);
    }
    cursor = (cursor + step) % pdfPaths.length;
  }

  return selected;
}

function computeEligibleStudents(students, criteria) {
  return students.filter((student) => {
    if (criteria.minCgpa !== undefined && student.cgpa < criteria.minCgpa) return false;
    if (criteria.maxBacklogs !== undefined && student.backlogs > criteria.maxBacklogs) return false;
    if (criteria.minAttendance !== undefined && student.attendancePct < criteria.minAttendance) return false;
    if (criteria.branches?.length && !criteria.branches.includes(student.branch)) return false;
    return true;
  });
}

async function seedCollege({
  db,
  college,
  passwordHash,
  topicByKey,
  materialPdfPaths,
  collegeIndex,
  platformAdmin,
}) {
  const rng = createRng(`${BASE_SEED}-${college.slug}-${collegeIndex}`);
  const now = new Date().toISOString();
  const tenantId = randomUUID();
  const tenantCreatedAt = randomPastDateTime(rng, 540, 420);

  await db.collection("tenants").insertOne({
    id: tenantId,
    name: college.name,
    slug: college.slug,
    is_active: true,
    config: {
      brand: { primaryColor: college.brandColor },
      ai_enabled: true,
    },
    created_at: tenantCreatedAt,
    updated_at: now,
  });

  const tpoUserId = randomUUID();

  const users = [
    {
      id: tpoUserId,
      tenant_id: tenantId,
      email: college.tpoEmail,
      password_hash: passwordHash,
      role: "tpo",
      full_name: college.tpoName,
      is_active: true,
      created_at: tenantCreatedAt,
      updated_at: now,
    },
  ];

  if (platformAdmin) {
    users.push({
      id: randomUUID(),
      tenant_id: tenantId,
      email: platformAdmin.email,
      password_hash: passwordHash,
      role: "admin",
      full_name: platformAdmin.fullName,
      is_active: true,
      created_at: tenantCreatedAt,
      updated_at: now,
    });
  }

  const students = [];
  const studentUsers = [];
  const studentStates = [];

  const usedNames = new Set();
  for (let index = 1; index <= college.studentCount; index += 1) {
    let firstName = FIRST_NAMES[(index * 7 + randomInt(rng, 0, FIRST_NAMES.length - 1)) % FIRST_NAMES.length];
    let lastName = LAST_NAMES[(index * 11 + randomInt(rng, 0, LAST_NAMES.length - 1)) % LAST_NAMES.length];
    let fullName = `${firstName} ${lastName}`;
    if (usedNames.has(fullName)) {
      firstName = FIRST_NAMES[(index * 13 + randomInt(rng, 0, FIRST_NAMES.length - 1)) % FIRST_NAMES.length];
      lastName = LAST_NAMES[(index * 17 + randomInt(rng, 0, LAST_NAMES.length - 1)) % LAST_NAMES.length];
      fullName = `${firstName} ${lastName}`;
    }
    usedNames.add(fullName);

    const userId = randomUUID();
    const studentId = randomUUID();
    const branch = weightedPick(rng, BRANCH_WEIGHTS);
    const batch = weightedPick(rng, BATCH_WEIGHTS);

    const cgpaBase = 7.1 + branchBias(branch);
    const cgpa = Number(clamp(cgpaBase + randomNormal(rng) * 0.95, 5.1, 9.86).toFixed(2));

    let backlogProbability = 0.35;
    if (cgpa >= 8.5) backlogProbability = 0.05;
    else if (cgpa >= 7.5) backlogProbability = 0.12;
    else if (cgpa >= 6.6) backlogProbability = 0.22;
    const backlogs = chance(rng, backlogProbability) ? randomInt(rng, 1, chance(rng, 0.2) ? 3 : 2) : 0;

    const attendancePct = Number(
      clamp(72 + cgpa * 2.2 + randomNormal(rng) * 8 - backlogs * 3.8, 56, 98).toFixed(1),
    );

    const email = `student${String(index).padStart(3, "0")}@${college.domain}`;
    const createdAt = randomPastDateTime(rng, 520, 120);
    const rollNumber = `${college.rollPrefix}${batch}${String(index).padStart(3, "0")}`;
    const skills = pickSkills(rng, branch);
    const city = pick(rng, CITY_POOL);

    studentUsers.push({
      id: userId,
      tenant_id: tenantId,
      email,
      password_hash: passwordHash,
      role: "student",
      full_name: fullName,
      is_active: true,
      created_at: createdAt,
      updated_at: now,
    });

    students.push({
      id: studentId,
      tenant_id: tenantId,
      user_id: userId,
      roll_number: rollNumber,
      branch,
      batch,
      cgpa,
      backlogs,
      attendance_pct: attendancePct,
      points: 0,
      readiness_score: 0,
      streak_current: 0,
      streak_longest: 0,
      skills,
      profile_data: {
        city,
        target_role: chance(rng, 0.55) ? "Software Engineer" : "Analyst",
        linkedin: `https://linkedin.com/in/${slugify(fullName)}-${index}`,
      },
      created_at: createdAt,
      updated_at: now,
    });

    studentStates.push({
      id: studentId,
      userId,
      fullName,
      email,
      branch,
      batch,
      cgpa,
      backlogs,
      attendancePct,
      studyPoints: 0,
      testPoints: 0,
      totalStudyHours: 0,
      studyDates: new Set(),
      topicStudyHours: new Map(),
      topicStudySessions: new Map(),
      testScores: [],
      topicPerf: new Map(),
      masteryByTopic: new Map(),
    });
  }

  users.push(...studentUsers);
  await insertManyChunked(db, "users", users, 1500);
  await insertManyChunked(db, "students", students, 1500);

  const companyNames = buildCompanyNames(college.slug);
  const companies = companyNames.map((name, index) => ({
    id: randomUUID(),
    tenant_id: tenantId,
    name,
    slug: `${slugify(name)}-${college.slug}-${index + 1}`,
    logo_url: null,
    created_at: randomPastDateTime(rng, 340, 40),
    updated_at: now,
  }));
  await insertManyChunked(db, "companies", companies);

  const companyIds = companies.map((company) => company.id);

  const resources = [];
  const topicKeys = TOPIC_DEFS.map((topic) => topic.key);
  const pdfSelectionCount = Math.min(130, Math.max(60, materialPdfPaths.length));
  const selectedPdfs = selectMaterialSlice(materialPdfPaths, pdfSelectionCount, collegeIndex * 97);

  if (selectedPdfs.length > 0) {
    selectedPdfs.forEach((relativePath, index) => {
      const topicKey = inferTopicKeyFromPath(relativePath) ?? topicKeys[index % topicKeys.length];
      const topicId = topicByKey.get(topicKey);
      const sourcePdf = relativePath.replace(/\\/g, "/");
      const folderHint = sourcePdf.split("/").slice(0, 2).join(" / ");
      resources.push({
        id: randomUUID(),
        tenant_id: tenantId,
        topic_id: topicId ?? null,
        title: titleFromPdfPath(sourcePdf),
        description: `Curated study PDF from ${folderHint || "material repository"}.`,
        resource_type: "pdf",
        url: `material/${sourcePdf}`,
        source_pdf: sourcePdf,
        thumbnail_url: null,
        duration_sec: randomInt(rng, 900, 10_800),
        is_active: true,
        created_at: randomPastDateTime(rng, 280, 10),
        updated_at: now,
      });
    });
  } else {
    for (let index = 0; index < 70; index += 1) {
      const topicKey = topicKeys[index % topicKeys.length];
      const topic = TOPIC_DEFS.find((item) => item.key === topicKey);
      resources.push({
        id: randomUUID(),
        tenant_id: tenantId,
        topic_id: topicByKey.get(topicKey) ?? null,
        title: `${topic?.name ?? "Placement Topic"} Handbook ${index + 1}`,
        description: "Fallback seeded resource. Material folder PDFs were not found during seed run.",
        resource_type: "pdf",
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        source_pdf: null,
        thumbnail_url: null,
        duration_sec: randomInt(rng, 900, 7200),
        is_active: true,
        created_at: randomPastDateTime(rng, 280, 10),
        updated_at: now,
      });
    }
  }

  await insertManyChunked(db, "resources", resources, 1000);

  const mockTests = [];
  for (const topicKey of TEST_TOPIC_KEYS) {
    const topicId = topicByKey.get(topicKey) ?? null;
    const topicName = TOPIC_DEFS.find((topic) => topic.key === topicKey)?.name ?? "Placement Prep";

    for (const difficulty of DIFFICULTIES) {
      const difficultyLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
      const questionCount = difficulty === "easy" ? 12 : difficulty === "medium" ? 15 : 18;
      const companyId = chance(rng, 0.35) ? pick(rng, companyIds) : null;

      mockTests.push({
        id: randomUUID(),
        tenant_id: tenantId,
        title: `${topicName} ${difficultyLabel} Test`,
        topic_id: topicId,
        company_id: companyId,
        duration_sec: difficulty === "easy" ? 2700 : difficulty === "medium" ? 3600 : 4500,
        difficulty,
        is_active: true,
        questions: buildQuestionsForTest(topicKey, topicName, difficulty, questionCount, rng),
        created_by: tpoUserId,
        created_at: randomPastDateTime(rng, 150, 5),
        updated_at: now,
      });
    }
  }

  await insertManyChunked(db, "mock_tests", mockTests);

  const studyHoursRows = [];
  const attemptRows = [];
  const masteryRows = [];
  const progressRows = [];
  const aiConversationRows = [];

  for (const student of studentStates) {
    const engagement =
      clamp(
        (student.cgpa - 5.1) / 4.8 + (student.attendancePct - 60) / 45 - student.backlogs * 0.12 + rng() * 0.25,
        0.15,
        1.25,
      );

    const sessionCount = clamp(Math.round(12 + engagement * 42 + randomNormal(rng) * 4), 10, 72);
    const topicWeights = BRANCH_TOPIC_WEIGHTS[student.branch] ?? BRANCH_TOPIC_WEIGHTS.CSE;

    for (let session = 0; session < sessionCount; session += 1) {
      const topicKey = weightedPick(rng, topicWeights);
      const topicId = topicByKey.get(topicKey);
      if (!topicId) continue;
      const studyDate = randomStudyDate(rng, 95);
      const hours = Number(clamp(randomFloat(rng, 0.6, 3.6, 2), 0.5, 4.0).toFixed(2));
      const pointsAwarded = Math.max(1, Math.floor(hours * 10));

      studyHoursRows.push({
        id: randomUUID(),
        tenant_id: tenantId,
        student_id: student.id,
        topic_id: topicId,
        study_date: studyDate,
        hours,
        points_awarded: pointsAwarded,
        created_at: `${studyDate}T${String(randomInt(rng, 8, 22)).padStart(2, "0")}:${String(randomInt(rng, 0, 59)).padStart(2, "0")}:00.000Z`,
      });

      student.studyPoints += pointsAwarded;
      student.totalStudyHours += hours;
      student.studyDates.add(studyDate);
      student.topicStudyHours.set(topicId, (student.topicStudyHours.get(topicId) ?? 0) + hours);
      student.topicStudySessions.set(topicId, (student.topicStudySessions.get(topicId) ?? 0) + 1);
    }

    const attemptCount = clamp(Math.round(2 + engagement * 12 + randomNormal(rng) * 2.5), 2, 20);
    for (let attemptIndex = 0; attemptIndex < attemptCount; attemptIndex += 1) {
      const preferredDifficulty =
        engagement > 0.85 ? "hard" : engagement > 0.55 ? "medium" : "easy";

      const candidates = mockTests.filter((test) => {
        if (preferredDifficulty === "hard") return test.difficulty !== "easy";
        if (preferredDifficulty === "easy") return test.difficulty !== "hard" || chance(rng, 0.2);
        return true;
      });
      const test = pick(rng, candidates.length > 0 ? candidates : mockTests);
      const questionCount = test.questions.length;
      const penalty = test.difficulty === "hard" ? 0.16 : test.difficulty === "medium" ? 0.08 : 0.02;
      const accuracy = clamp(0.3 + engagement * 0.5 - penalty + randomNormal(rng) * 0.06, 0.12, 0.95);
      const attemptedQuestions = clamp(randomInt(rng, questionCount - 4, questionCount), 4, questionCount);
      const attemptedIndices = sampleIndices(rng, attemptedQuestions, questionCount);

      const answers = [];
      let correctCount = 0;
      for (const questionIndex of attemptedIndices) {
        const question = test.questions[questionIndex];
        const isCorrect = chance(rng, accuracy);
        const selectedOption = isCorrect
          ? question.correctIndex
          : randomDifferentOption(rng, question.options.length, question.correctIndex);
        if (isCorrect) correctCount += 1;
        answers.push({
          questionIndex,
          selectedOption,
          isCorrect,
        });
      }

      const score = Number(((correctCount / questionCount) * 100).toFixed(2));
      const timeTakenSec = randomInt(
        rng,
        Math.max(180, Math.floor(test.duration_sec * 0.45)),
        Math.max(300, Math.floor(test.duration_sec * 0.95)),
      );
      const submittedAt = randomPastDateTime(rng, 110, 1);
      const startedAt = new Date(new Date(submittedAt).getTime() - timeTakenSec * 1000).toISOString();
      const topicId = String(test.topic_id ?? topicByKey.get("aptitude"));

      attemptRows.push({
        id: randomUUID(),
        tenant_id: tenantId,
        student_id: student.id,
        test_id: test.id,
        status: "submitted",
        started_at: startedAt,
        submitted_at: submittedAt,
        answers,
        score,
        time_taken_sec: timeTakenSec,
        topic_breakdown: {
          [topicId]: {
            correct: correctCount,
            total: questionCount,
          },
        },
        idempotency_key: randomUUID(),
        created_at: startedAt,
      });

      const pointsFromAttempt = Math.max(5, Math.round(score / 2));
      student.testPoints += pointsFromAttempt;
      student.testScores.push(score);

      const existingPerf = student.topicPerf.get(topicId) ?? { total: 0, correct: 0 };
      existingPerf.total += questionCount;
      existingPerf.correct += correctCount;
      student.topicPerf.set(topicId, existingPerf);
    }

    if (chance(rng, 0.18)) {
      const pendingTest = pick(rng, mockTests);
      const startedAt = randomPastDateTime(rng, 6, 0);
      attemptRows.push({
        id: randomUUID(),
        tenant_id: tenantId,
        student_id: student.id,
        test_id: pendingTest.id,
        status: "pending",
        started_at: startedAt,
        submitted_at: null,
        answers: [],
        score: 0,
        time_taken_sec: 0,
        topic_breakdown: {},
        idempotency_key: null,
        created_at: startedAt,
      });
    }

    for (const topic of TOPIC_DEFS) {
      const topicId = topicByKey.get(topic.key);
      if (!topicId) continue;

      const perf = student.topicPerf.get(topicId);
      const studyHours = student.topicStudyHours.get(topicId) ?? 0;
      const studySessions = student.topicStudySessions.get(topicId) ?? 0;
      const shouldCreateMastery = Boolean(perf) || studyHours >= 1.5 || chance(rng, 0.22);

      let masteryLevel = 0;
      if (shouldCreateMastery) {
        const totalAttempts = perf
          ? perf.total
          : Math.max(4, Math.round(studyHours * 2.5 + randomInt(rng, 0, 8)));
        const estimatedMastery = perf
          ? (perf.correct / Math.max(perf.total, 1)) * 100
          : clamp(25 + studyHours * 7 + (student.cgpa - 5) * 8 + randomNormal(rng) * 8, 18, 94);
        masteryLevel = Number(clamp(estimatedMastery, 8, 98).toFixed(2));
        const correctAttempts = Math.round((masteryLevel / 100) * totalAttempts);
        const confidenceScore = clamp(Math.round(totalAttempts * 4 + studySessions * 2), 5, 100);
        const assessedAt = randomPastDateTime(rng, 45, 0);

        masteryRows.push({
          id: randomUUID(),
          tenant_id: tenantId,
          student_id: student.id,
          topic_id: topicId,
          mastery_level: masteryLevel,
          total_attempts: totalAttempts,
          correct_attempts: correctAttempts,
          last_assessed: assessedAt,
          confidence_score: confidenceScore,
          created_at: assessedAt,
          updated_at: now,
        });

        student.masteryByTopic.set(topicId, masteryLevel);
      }

      let status = "incomplete";
      if (masteryLevel >= 78 || studyHours >= 14) status = "complete";
      else if (masteryLevel >= 45 || studyHours >= 3) status = "in_progress";

      if (status !== "incomplete" || chance(rng, 0.28)) {
        const updatedAt = randomPastDateTime(rng, 30, 0);
        progressRows.push({
          id: randomUUID(),
          tenant_id: tenantId,
          student_id: student.id,
          topic_id: topicId,
          status,
          covered: status !== "incomplete",
          updated_at: updatedAt,
          completed_at: status === "complete" ? updatedAt : null,
          created_at: randomPastDateTime(rng, 160, 10),
        });
      }
    }

    const streak = computeStreakMetrics(student.studyDates);
    const baseBonus = Math.max(
      0,
      Math.round((student.cgpa - 6.2) * 22 + (student.attendancePct - 75) * 1.2 - student.backlogs * 15),
    );
    const points = Math.round(student.studyPoints + student.testPoints + baseBonus);
    const avgMastery = average([...student.masteryByTopic.values()]);
    const avgTestScore = average(student.testScores);
    const readinessScore = estimateReadiness({
      avgTestScore,
      avgMastery,
      totalStudyHours: student.totalStudyHours,
      points,
    });

    student.points = points;
    student.readinessScore = readinessScore;
    student.streakCurrent = streak.current;
    student.streakLongest = streak.longest;

    if (chance(rng, 0.15)) {
      const topicKey = pick(rng, ["aptitude", "dsa", "sql", "os", "cn", "interview", "project"]);
      const createdAt = randomPastDateTime(rng, 21, 0);
      const messageText = `How do I improve my ${topicKey} preparation for upcoming placements?`;
      const assistantText = `Build a weekly plan for ${topicKey}: revise core concepts, solve 20 practice questions, and track mistakes daily.`;
      const promptTokens = randomInt(rng, 120, 260);
      const completionTokens = randomInt(rng, 90, 220);
      aiConversationRows.push({
        id: randomUUID(),
        tenant_id: tenantId,
        student_id: student.id,
        messages: [
          { role: "user", content: messageText, timestamp: createdAt },
          { role: "assistant", content: assistantText, timestamp: createdAt },
        ],
        model: "local-fallback",
        topic: topicKey,
        token_usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        created_at: createdAt,
        updated_at: createdAt,
      });
    }
  }

  await insertManyChunked(db, "study_hours", studyHoursRows, 1200);
  await insertManyChunked(db, "student_attempts", attemptRows, 1000);
  await insertManyChunked(db, "topic_mastery", masteryRows, 1200);
  await insertManyChunked(db, "student_topic_progress", progressRows, 1500);
  await insertManyChunked(db, "ai_conversations", aiConversationRows, 800);

  const studentUpdateOps = studentStates.map((student) => ({
    updateOne: {
      filter: { tenant_id: tenantId, id: student.id },
      update: {
        $set: {
          points: student.points,
          readiness_score: student.readinessScore,
          streak_current: student.streakCurrent,
          streak_longest: student.streakLongest,
          updated_at: now,
        },
      },
    },
  }));
  if (studentUpdateOps.length > 0) {
    await db.collection("students").bulkWrite(studentUpdateOps);
  }

  const driveConfigs = generateDriveConfigs(rng);
  const drives = [];
  const driveResults = [];

  for (let index = 0; index < driveConfigs.length; index += 1) {
    const config = driveConfigs[index];
    const company = companies[index % companies.length];
    const criteriaBranches = [];
    const branchPool = [...BRANCH_WEIGHTS];
    const branchSelectionCount = randomInt(rng, 2, 4);
    while (criteriaBranches.length < branchSelectionCount && branchPool.length > 0) {
      const item = pick(rng, branchPool);
      criteriaBranches.push(item.value);
      const removeIndex = branchPool.findIndex((entry) => entry.value === item.value);
      branchPool.splice(removeIndex, 1);
    }

    const criteria = {
      minCgpa: config.minCgpa,
      maxBacklogs: config.maxBacklogs,
      minAttendance: config.minAttendance,
      branches: criteriaBranches,
    };

    const driveDate = toIsoDateOffset(config.dayOffset);
    const eligibleStudents = computeEligibleStudents(studentStates, criteria);
    const eligibleCount = eligibleStudents.length;
    const createdAt = randomPastDateTime(rng, 120, 2);
    const driveId = randomUUID();

    drives.push({
      id: driveId,
      tenant_id: tenantId,
      company: company.name,
      role: config.role,
      drive_date: driveDate,
      criteria,
      status: config.status,
      eligible_count: eligibleCount,
      created_by: tpoUserId,
      created_at: createdAt,
      updated_at: now,
      deleted_at: null,
    });

    const participants = config.status === "cancelled"
      ? eligibleStudents.slice(0, Math.max(0, Math.floor(eligibleStudents.length * 0.4)))
      : eligibleStudents;

    for (const student of participants) {
      let outcome = "pending";
      if (config.status === "completed") {
        const chanceValue = rng();
        if (chanceValue < 0.2) outcome = "selected";
        else if (chanceValue < 0.45) outcome = "shortlisted";
        else outcome = "rejected";
      } else if (config.status === "active") {
        const chanceValue = rng();
        if (chanceValue < 0.1) outcome = "selected";
        else if (chanceValue < 0.3) outcome = "shortlisted";
        else if (chanceValue < 0.42) outcome = "rejected";
        else outcome = "pending";
      } else if (config.status === "upcoming") {
        outcome = chance(rng, 0.14) ? "shortlisted" : "pending";
      } else if (config.status === "cancelled") {
        outcome = "pending";
      }

      let remarks = null;
      if (outcome === "selected") remarks = "Strong interview performance and communication.";
      if (outcome === "shortlisted") remarks = "Cleared online assessment and technical screening.";
      if (outcome === "rejected") remarks = "Needs improvement in coding speed and accuracy.";

      driveResults.push({
        id: randomUUID(),
        tenant_id: tenantId,
        drive_id: driveId,
        student_id: student.id,
        status: "eligible",
        outcome,
        remarks,
        created_at: createdAt,
        updated_at: now,
      });
    }
  }

  await insertManyChunked(db, "drives", drives);
  await insertManyChunked(db, "drive_results", driveResults, 1500);

  const vaultItemTypes = ["question", "tip", "past_paper", "experience"];
  const vaultItems = [];
  for (const company of companies) {
    const count = randomInt(rng, 4, 8);
    for (let index = 0; index < count; index += 1) {
      const topic = pick(rng, TOPIC_DEFS);
      const type = pick(rng, vaultItemTypes);
      const difficulty = chance(rng, 0.15) ? "hard" : chance(rng, 0.55) ? "medium" : "easy";
      const createdAt = randomPastDateTime(rng, 360, 30);
      vaultItems.push({
        id: randomUUID(),
        tenant_id: tenantId,
        company_id: company.id,
        type,
        title: `${company.name} ${topic.name} ${type.replace("_", " ")}`,
        content:
          type === "experience"
            ? `${company.name} interview pattern: OA, technical, HR. Focus area: ${topic.name}.`
            : type === "tip"
              ? `For ${company.name}, revise ${topic.name} and solve timed practice before interview day.`
              : `Previous ${company.name} ${topic.name} questions curated for preparation.`,
        author: chance(rng, 0.6) ? "Placement Cell" : "Anonymous",
        difficulty,
        topic_id: topicByKey.get(topic.key) ?? null,
        created_at: createdAt,
        updated_at: now,
      });
    }
  }
  await insertManyChunked(db, "vault_items", vaultItems, 1200);

  const customTemplates = [
    {
      id: randomUUID(),
      tenant_id: tenantId,
      name: "Weekly Prep Reminder",
      slug: `weekly-prep-reminder-${college.slug}`,
      subject: "Weekly Placement Preparation Reminder",
      body: "Dear {{student_name}},\nPlease complete your weekly preparation plan and keep your profile updated.",
      is_system: false,
      created_by: tpoUserId,
      created_at: randomPastDateTime(rng, 180, 20),
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      name: "Shortlist Intimation",
      slug: `shortlist-intimation-${college.slug}`,
      subject: "You are shortlisted for {{drive_name}}",
      body: "Dear {{student_name}},\nCongratulations. You are shortlisted for {{drive_name}}. Check dashboard for next steps.",
      is_system: false,
      created_by: tpoUserId,
      created_at: randomPastDateTime(rng, 180, 20),
      updated_at: now,
    },
  ];
  await insertManyChunked(db, "email_templates", customTemplates);

  const communications = [];
  const recipientEmails = studentStates.map((student) => student.email);
  const historySpecs = [
    { status: "sent", subject: "Weekly placement tracker", recipients: 52 },
    { status: "partial", subject: "Mock test reminder", recipients: 40 },
    { status: "queued", subject: "Upcoming drive announcement", recipients: 68 },
    { status: "failed", subject: "Profile completion alert", recipients: 25 },
    { status: "sent", subject: "Interview process guidance", recipients: 36 },
  ];

  for (const spec of historySpecs) {
    const createdAt = randomPastDateTime(rng, 40, 1);
    const recipients = [];
    const seen = new Set();
    while (recipients.length < Math.min(spec.recipients, recipientEmails.length)) {
      const email = pick(rng, recipientEmails);
      if (!seen.has(email)) {
        recipients.push(email);
        seen.add(email);
      }
    }

    const sentCount = spec.status === "failed" ? 0 : spec.status === "partial" ? Math.floor(recipients.length * 0.72) : recipients.length;
    const failedCount = recipients.length - sentCount;
    communications.push({
      id: randomUUID(),
      tenant_id: tenantId,
      sender_id: tpoUserId,
      channel: "email",
      subject: spec.subject,
      body: `Automated placement communication: ${spec.subject}`,
      recipients,
      status: spec.status,
      provider: "mock",
      provider_message_id: spec.status === "queued" ? null : `mock-${randomUUID()}`,
      sent_at: spec.status === "sent" || spec.status === "partial" ? createdAt : null,
      metadata: {
        sent: sentCount,
        failed: failedCount,
        errors:
          failedCount > 0
            ? [{ email: recipients[0], message: "Mailbox unavailable" }]
            : [],
      },
      created_at: createdAt,
      updated_at: now,
    });
  }

  await insertManyChunked(db, "communications", communications);

  return {
    tenantId,
    tenantName: college.name,
    slug: college.slug,
    students: college.studentCount,
    tpoEmail: college.tpoEmail,
    adminEmail: platformAdmin?.email ?? null,
    sampleStudents: studentStates.slice(0, 3).map((student) => ({
      email: student.email,
      name: student.fullName,
    })),
    counts: {
      users: users.length,
      students: students.length,
      companies: companies.length,
      resources: resources.length,
      mockTests: mockTests.length,
      attempts: attemptRows.length,
      studyHours: studyHoursRows.length,
      mastery: masteryRows.length,
      topicProgress: progressRows.length,
      drives: drives.length,
      driveResults: driveResults.length,
      vaultItems: vaultItems.length,
      communications: communications.length,
    },
  };
}

async function createIndexes(db) {
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ tenant_id: 1 });
  await db.collection("users").createIndex(
    { role: 1 },
    {
      unique: true,
      partialFilterExpression: { role: "admin" },
      name: "users_single_admin_role",
    },
  );
  await db.collection("students").createIndex({ tenant_id: 1, user_id: 1 }, { unique: true });
  await db.collection("students").createIndex({ tenant_id: 1, roll_number: 1 });
  await db.collection("students").createIndex({ tenant_id: 1, points: -1 });
  await db.collection("topics").createIndex({ tenant_id: 1, name: 1 });
  await db.collection("mock_tests").createIndex({ tenant_id: 1, is_active: 1 });
  await db.collection("student_attempts").createIndex({ tenant_id: 1, student_id: 1, test_id: 1 });
  await db.collection("student_attempts").createIndex({ tenant_id: 1, student_id: 1, idempotency_key: 1 });
  await db.collection("topic_mastery").createIndex({ tenant_id: 1, student_id: 1, topic_id: 1 }, { unique: true });
  await db.collection("student_topic_progress").createIndex({ tenant_id: 1, student_id: 1, topic_id: 1 }, { unique: true });
  await db.collection("drives").createIndex({ tenant_id: 1, status: 1 });
  await db.collection("drive_results").createIndex({ tenant_id: 1, drive_id: 1 });
  await db.collection("drive_results").createIndex({ tenant_id: 1, student_id: 1 });
  await db.collection("drive_eligibility_snapshots").createIndex({ tenant_id: 1, drive_id: 1, version: -1 });
  await db.collection("study_hours").createIndex({ tenant_id: 1, student_id: 1, study_date: -1 });
  await db.collection("student_activity_events").createIndex({ tenant_id: 1, id: 1 }, { unique: true });
  await db.collection("student_activity_events").createIndex({ tenant_id: 1, student_id: 1, created_at: -1 });
  await db.collection("ai_conversations").createIndex({ tenant_id: 1, student_id: 1 });
  await db.collection("vault_items").createIndex({ tenant_id: 1, company_id: 1 });
  await db.collection("resources").createIndex({ tenant_id: 1, topic_id: 1 });
  await db.collection("communications").createIndex({ tenant_id: 1, created_at: -1 });
  await db.collection("communications").createIndex({ id: 1 }, { unique: true });
  await db.collection("communications").createIndex({ tenant_id: 1, status: 1, updated_at: -1 });
  await db.collection("email_templates").createIndex({ tenant_id: 1, slug: 1 });
  await db.collection("tenant_analytics").createIndex({ tenant_id: 1 }, { unique: true });
  await db.collection("tenants").createIndex({ slug: 1 }, { unique: true });
}

async function seed() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  try {
    console.log(`Seeding database: ${DB_NAME}`);

    const collections = [
      "tenants",
      "users",
      "students",
      "topics",
      "mock_tests",
      "student_attempts",
      "topic_mastery",
      "student_topic_progress",
      "drives",
      "drive_results",
      "drive_eligibility_snapshots",
      "study_hours",
      "points_log",
      "ai_conversations",
      "vault_items",
      "resources",
      "companies",
      "email_templates",
      "communications",
      "tenant_analytics",
    ];

    for (const name of collections) {
      await db.collection(name).deleteMany({});
    }

    const now = new Date().toISOString();
    const globalTopics = TOPIC_DEFS.map((topic) => ({
      id: randomUUID(),
      tenant_id: null,
      name: topic.name,
      created_at: now,
      updated_at: now,
    }));
    await insertManyChunked(db, "topics", globalTopics);
    const topicByKey = new Map(globalTopics.map((topic, index) => [TOPIC_DEFS[index].key, topic.id]));

    const systemTemplates = [
      {
        id: randomUUID(),
        tenant_id: null,
        name: "Drive Announcement",
        slug: "drive-announcement",
        subject: "New Drive: {{drive_name}}",
        body: "Dear {{student_name}},\nA new placement drive {{drive_name}} has been announced.\nPlease check your dashboard.",
        is_system: true,
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        tenant_id: null,
        name: "Eligibility Notification",
        slug: "eligibility-notification",
        subject: "You are eligible for {{drive_name}}",
        body: "Dear {{student_name}},\nYou are eligible for {{drive_name}}. Prepare well and all the best.",
        is_system: true,
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        tenant_id: null,
        name: "Result Published",
        slug: "result-published",
        subject: "Drive results published for {{drive_name}}",
        body: "Dear {{student_name}},\nDrive results are now available for {{drive_name}}.\nCheck your portal for details.",
        is_system: true,
        created_by: null,
        created_at: now,
        updated_at: now,
      },
    ];
    await insertManyChunked(db, "email_templates", systemTemplates);

    const materialRoot = resolveMaterialRoot();
    const materialPdfPaths = collectPdfFiles(materialRoot, 520);
    console.log(`Detected material PDFs: ${materialPdfPaths.length}`);

    const passwordHash = await hash(DEFAULT_PASSWORD, 10);
    const summaries = [];
    for (let index = 0; index < COLLEGES.length; index += 1) {
      const summary = await seedCollege({
        db,
        college: COLLEGES[index],
        passwordHash,
        topicByKey,
        materialPdfPaths,
        collegeIndex: index,
        platformAdmin: index === 0 ? PLATFORM_ADMIN : null,
      });
      summaries.push(summary);
    }

    console.log("Creating indexes...");
    await createIndexes(db);

    console.log("Seed complete!");
    console.log("--------------------------------------------------");
    console.log(`Tenants: ${summaries.length}`);
    console.log(`Total students: ${summaries.reduce((sum, item) => sum + item.students, 0)}`);
    console.log(`Platform Admin Login: ${PLATFORM_ADMIN.email} / ${DEFAULT_PASSWORD}`);

    for (const summary of summaries) {
      console.log("");
      console.log(`${summary.tenantName} (${summary.slug})`);
      console.log(`  Tenant ID: ${summary.tenantId}`);
      console.log(`  Students: ${summary.students}`);
      console.log(`  TPO Login: ${summary.tpoEmail} / ${DEFAULT_PASSWORD}`);
      console.log("  Sample Student Logins:");
      for (const sample of summary.sampleStudents) {
        console.log(`    ${sample.email} / ${DEFAULT_PASSWORD} (${sample.name})`);
      }
      console.log("  Data Counts:");
      console.log(`    users=${summary.counts.users}`);
      console.log(`    companies=${summary.counts.companies}`);
      console.log(`    resources=${summary.counts.resources}`);
      console.log(`    mockTests=${summary.counts.mockTests}`);
      console.log(`    attempts=${summary.counts.attempts}`);
      console.log(`    studyHours=${summary.counts.studyHours}`);
      console.log(`    mastery=${summary.counts.mastery}`);
      console.log(`    topicProgress=${summary.counts.topicProgress}`);
      console.log(`    drives=${summary.counts.drives}`);
      console.log(`    driveResults=${summary.counts.driveResults}`);
      console.log(`    communications=${summary.counts.communications}`);
    }
  } finally {
    await client.close();
  }
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});


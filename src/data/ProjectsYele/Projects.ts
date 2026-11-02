import P1_1 from "../../assets/images/Home/ProjectsY/P1_1.webp";
import P2_1 from "../../assets/images/Home/ProjectsY/P2_1.webp";
import P3_1 from "../../assets/images/Home/ProjectsY/P3_1.webp";
import P4_1 from "../../assets/images/Home/ProjectsY/P4_1.webp";

interface Project {
  id: number;
  title: string;
  Tipo: string;
  Lugar: string;
  image: ImageMetadata;
  alt?: string;
  description: string;
}

export const ProjectsYele: Project[] = [
  {
    id: 1,
    title: "Instalación de luminarias",
    Tipo: "Residencial",
    Lugar: "Miraflores - Lima",
    image: P1_1,
    alt: "Instalación de luminarias",
    description: "Instalación de luminarias para mejorar la iluminación y funcionalidad de los espacios.",
  },
  {
    id: 2,
    title: "Elaboración de pozo a tierra",
    Tipo: "Residencial",
    Lugar: "San Martín de Porres - Lima",
    image: P2_1,
    alt: "Elaboración de pozo a tierra",
    description: "Implementación de un sistema de puesta a tierra para brindar protección y seguridad eléctrica.",
  },
  {
    id: 3,
    title: "Entubado EMT en altura",
    Tipo: "Industrial",
    Lugar: "Ate - Lima",
    image: P3_1,
    alt: "Entubado EMT en altura",
    description: "Instalación de tuberías EMT en altura para proteger y organizar las canalizaciones eléctricas.",
  },
  {
    id: 4,
    title: "Montaje de tablero eléctrico",
    Tipo: "Industrial",
    Lugar: "Ate - Lima",
    image: P4_1,
    alt: "Montaje de tablero eléctrico",
    description: "Montaje de tablero eléctrico para la distribución y control seguro de la energía.",
  },
];
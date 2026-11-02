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
}

export const ProjectsYele: Project[] = [
  {
    id: 1,
    title: "Instalación de luminarias",
    Tipo: "Residencial",
    Lugar: "Miraflores - Lima",
    image: P1_1,
    alt: "Project 1 image",
  },
  {
    id: 2,
    title: "Elaboracion de Pozo a Tierra",
    Tipo: "Residencial",
    Lugar: "San Martin de Porres - Lima",
    image: P2_1,
    alt: "Project 2 image",
  },
  {
    id: 3,
    title: "Entubado EMT en altura",
    Tipo: "Industrial",
    Lugar: "Ate - Lima",
    image: P3_1,
    alt: "Project 3 image",
  },
  {
    id: 4,
    title: "Montaje de tablero de eléctrico",
    Tipo: "Industrial",
    Lugar: "Ate - Lima",
    image: P4_1,
    alt: "Project 4 image",
  },
  

];
export {};
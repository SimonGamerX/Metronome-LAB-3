cmake_minimum_required(VERSION 3.10)
project(metronome_core CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source files
set(SOURCES
    main.cpp
    metronome.cpp
)

# Header files
set(HEADERS
    metronome.hpp
)

add_executable(metronome_core ${SOURCES} ${HEADERS})

# Find WiringPi
find_library(WIRINGPI_LIB wiringPi)

if(WIRINGPI_LIB)
    message(STATUS "Found WiringPi: ${WIRINGPI_LIB}")
    target_link_libraries(metronome_core PRIVATE ${WIRINGPI_LIB} pthread)
    target_compile_definitions(metronome_core PRIVATE HAVE_WIRINGPI=1)
else()
    message(WARNING "WiringPi library not found. Compiling in Simulation / Headless mode.")
    target_link_libraries(metronome_core PRIVATE pthread)
    target_compile_definitions(metronome_core PRIVATE HAVE_WIRINGPI=0)
endif()
